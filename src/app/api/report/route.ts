// POST /api/report — voter-submitted "this stance is wrong" reports.
//
// Backs the ReportInaccurateButton in /candidate/[slug] (Phase 2D-quat §19.4).
// Reports queue in `candidate_reports` with status='open' for manual admin
// review on /admin. No public read — service-role only.
//
// Rate-limited (10/hr/session, 30/hr/IP) per REPORT_LIMITS.
// IP is HMAC-hashed before storage; raw IP is never persisted.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { COOKIE_NAMES, readCookie } from '@/lib/cookies';
import { clientIpFromHeaders, hashIp } from '@/lib/geo';
import { checkRateLimits, REPORT_LIMITS } from '@/lib/rate-limit';

const ReportSchema = z.object({
  candidate_id: z.string().min(1).max(120),
  stance_id: z.string().min(1).max(120).optional(),
  cited_bill_id: z.string().min(1).max(60).optional(),
  category: z.enum(['factual_error', 'wrong_attribution', 'outdated', 'other']),
  description: z.string().min(20).max(2000),
  reporter_email: z.string().email().max(254).optional(),
});

export async function POST(request: NextRequest) {
  // Rate limit FIRST — spam protection for the admin queue.
  const sessionId = (await readCookie(COOKIE_NAMES.session)) ?? null;
  const ip = clientIpFromHeaders(request.headers);
  const rate = checkRateLimits({
    sessionId,
    ip,
    sessionLimit: REPORT_LIMITS.session,
    ipLimit: REPORT_LIMITS.ip,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: 'rate_limited',
        scope: rate.exceeded,
        retry_after_seconds: rate.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(rate.retryAfterSeconds) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_json' },
      { status: 400 },
    );
  }

  const parsed = ReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_payload', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Service-role client because the table has no public SELECT/UPDATE
  // policies; we only allow inserts. Service role is necessary to return
  // a deterministic insert result (under anon, the INSERT succeeds but
  // the returned row may be null due to RLS).
  //
  // The service role key is server-only — never exposed to the client.
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceUrl || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: 'server_misconfigured' },
      { status: 500 },
    );
  }
  const sb = createClient(serviceUrl, serviceKey);

  const { data, error } = await sb
    .from('candidate_reports')
    .insert({
      candidate_id: parsed.data.candidate_id,
      session_id: sessionId,
      stance_id: parsed.data.stance_id ?? null,
      cited_bill_id: parsed.data.cited_bill_id ?? null,
      category: parsed.data.category,
      description: parsed.data.description,
      reporter_email: parsed.data.reporter_email ?? null,
      ip_hash: hashIp(ip),
    })
    .select('id')
    .single();

  if (error) {
    // Most likely cause: candidate_id doesn't exist (FK violation).
    // Treat as 400 — client sent a bad candidate reference.
    console.error('[api/report] insert error:', error.message);
    return NextResponse.json(
      { ok: false, error: 'insert_failed', detail: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, report_id: data?.id });
}
