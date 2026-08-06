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
import { getServiceClient } from '@/lib/data/adapter-service';
import { lookupSessionRowId } from '@/lib/app/session';
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

// Normalization must match the SQL backfill in migration 010 exactly:
// lower(btrim(description)). Same algorithm → same hash → dedup works.
async function descriptionHash(description: string): Promise<string> {
  const normalized = description.trim().toLowerCase();
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalized),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

export async function POST(request: NextRequest) {
  // Rate limit FIRST — spam protection for the admin queue.
  const sessionId = (await readCookie(COOKIE_NAMES.session)) ?? null;
  const ip = clientIpFromHeaders(request.headers);
  const rate = await checkRateLimits({
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
  let sb: ReturnType<typeof getServiceClient>;
  try {
    sb = getServiceClient();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'server_misconfigured' },
      { status: 500 },
    );
  }

  // candidate_reports.session_id FKs sessions.id (uuid), not the raw cookie
  // token — resolve it; an unknown token degrades to an anonymous report.
  const sessionRowId = sessionId ? await lookupSessionRowId(sessionId) : null;

  const { data, error } = await sb
    .from('candidate_reports')
    .insert({
      candidate_id: parsed.data.candidate_id,
      session_id: sessionRowId,
      stance_id: parsed.data.stance_id ?? null,
      cited_bill_id: parsed.data.cited_bill_id ?? null,
      category: parsed.data.category,
      description: parsed.data.description,
      description_hash: await descriptionHash(parsed.data.description),
      reporter_email: parsed.data.reporter_email ?? null,
      ip_hash: hashIp(ip),
    })
    .select('id')
    .single();

  if (error) {
    // Postgres unique_violation on ux_reports_dedup (migration 010): same
    // (ip_hash, candidate_id, description_hash) already submitted. Return
    // 200 silently — the spammer doesn't learn that dedup fired, and a
    // legit user re-clicking submit gets a successful-looking response.
    if (error.code === '23505') {
      return NextResponse.json({ ok: true, deduplicated: true });
    }
    console.error('[api/report] insert error:', error.message);
    // 23503 foreign_key_violation: the client referenced a candidate/stance
    // that doesn't exist — their input, 400. Anything else (outage, RLS,
    // schema drift) is our failure and must surface as 500, with no DB
    // internals leaked to the client.
    if (error.code === '23503') {
      return NextResponse.json(
        { ok: false, error: 'unknown_reference' },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { ok: false, error: 'write_failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, report_id: data?.id });
}
