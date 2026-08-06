import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { COOKIE_NAMES, readCookie } from '@/lib/cookies';
import { parseConsent } from '@/lib/consent';
import { clientIpFromHeaders } from '@/lib/geo';
import { checkRateLimits, INTERACTION_LIMITS } from '@/lib/rate-limit';
import { recordInteraction } from '@/lib/app/interactions';

const InteractionSchema = z.object({
  candidate_id: z.string().min(1),
  race_id: z.string().min(1),
  action: z.enum([
    'viewed',
    'saved',
    'unsaved',
    'viewed_detail',
    'viewed_donors',
    'viewed_votes',
    'viewed_statements',
    'source_clicked',
    'no_action',
  ]),
  view_order: z.number().int().nullable().optional(),
  dwell_ms: z.number().int().nullable().optional(),
});

/**
 * POST /api/interaction
 *
 * Records a user interaction with a candidate scorecard. Cheap, fire-and-forget.
 * Called by `trackInteraction` in src/lib/interactions-client.ts.
 *
 * Flow: this handler validates + gates, then hands off to the
 * application module (src/lib/app/interactions.ts), which resolves the
 * session row and writes candidate_interactions via the anon adapter.
 */
export async function POST(request: NextRequest) {
  // Rate limit FIRST. Bots scripting carousel events would otherwise
  // pollute candidate_interactions and contaminate the B2B sentiment data.
  const sessionId = (await readCookie(COOKIE_NAMES.session)) ?? null;
  const ip = clientIpFromHeaders(request.headers);
  const rate = await checkRateLimits({
    sessionId,
    ip,
    sessionLimit: INTERACTION_LIMITS.session,
    ipLimit: INTERACTION_LIMITS.ip,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited', scope: rate.exceeded, retry_after_seconds: rate.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  // JSON parse is a separate concern from validation: bad JSON is a client
  // error (400), not a server error (500). Without this split, malformed
  // POSTs from buggy clients pollute the 5xx error budget.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_json' },
      { status: 400 }
    );
  }

  const parsed = InteractionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_payload', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // No session cookie means nothing to key the row on — middleware sets
  // voter_session on every request, so this only fires for a
  // hand-crafted request that skipped it.
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: 'no_session' }, { status: 401 });
  }

  // Consent gate: explicit opt-out drops the row silently with 200.
  const consent = parseConsent(await readCookie(COOKIE_NAMES.consent));
  if (consent && !consent.analytics) {
    return NextResponse.json({ ok: true, dropped: 'consent' });
  }

  const result = await recordInteraction({
    sessionToken: sessionId,
    candidateId: parsed.data.candidate_id,
    raceId: parsed.data.race_id,
    action: parsed.data.action,
    viewOrder: parsed.data.view_order,
    dwellMs: parsed.data.dwell_ms,
  });

  if (!result.ok) {
    console.error('[api/interaction] write failed:', result.code, result.detail);
    return NextResponse.json({ ok: false, error: result.code }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
