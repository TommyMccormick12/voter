import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { COOKIE_NAMES, readCookie } from '@/lib/cookies';
import { parseConsent } from '@/lib/consent';
import { recordPageView, endVisit } from '@/lib/app/visits';
import { geoFromHeaders, hashUserAgent, clientIpFromHeaders } from '@/lib/geo';
import { checkRateLimits, VISIT_LIMITS } from '@/lib/rate-limit';

const StartSchema = z.object({
  type: z.literal('start').optional(),
  path: z.string().min(1).max(200),
});

const EndSchema = z.object({
  type: z.literal('end'),
});

const RequestSchema = z.union([StartSchema, EndSchema]);

/**
 * POST /api/visit
 *
 * Records a visit event for the current session. Consent-gated: drops
 * silently if consent_analytics is false.
 *
 * Two event shapes:
 *  - start: {type:"start", path: "/scorecards/race-nj-07"} — page view
 *  - end: {type:"end"} — beforeunload / pagehide flush
 *
 * Flow: this handler validates + gates, then hands off to the
 * application module (src/lib/app/visits.ts), which resolves the
 * session row and writes session_visits via the anon adapter.
 */
export async function POST(request: NextRequest) {
  // Rate limit first — bot-driven visit floods would skew the session_visits
  // engagement signal.
  const sessionId = (await readCookie(COOKIE_NAMES.session)) ?? null;
  const ip = clientIpFromHeaders(request.headers);
  const rate = await checkRateLimits({
    sessionId,
    ip,
    sessionLimit: VISIT_LIMITS.session,
    ipLimit: VISIT_LIMITS.ip,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited', scope: rate.exceeded, retry_after_seconds: rate.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_json' },
      { status: 400 }
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_payload', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // sessionId was read above for rate-limiting; here we just enforce
  // the prior no-session 401 contract.
  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: 'no_session' },
      { status: 401 }
    );
  }

  // Consent gate
  const consentRaw = await readCookie(COOKIE_NAMES.consent);
  const consent = parseConsent(consentRaw);
  if (!consent?.analytics) {
    // No consent recorded yet, or explicit opt-out — either way analytics
    // consent is absent, so nothing may be persisted. Silently drop with 200
    // (don't reveal whether opt-in would have logged anything).
    return NextResponse.json({ ok: true, dropped: 'consent' });
  }

  const data = parsed.data;
  if ('type' in data && data.type === 'end') {
    const result = await endVisit(sessionId);
    if (!result.ok) {
      console.error('[api/visit] end write failed:', result.code, result.detail);
      return NextResponse.json({ ok: false, error: result.code }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  }

  // start — record a page view (opens visit if needed)
  const geo = geoFromHeaders(request.headers);
  const uaHash = hashUserAgent(request.headers.get('user-agent'));
  const result = await recordPageView({
    sessionToken: sessionId,
    ipCountry: geo.country,
    ipRegion: geo.region,
    userAgentHash: uaHash,
  });
  if (!result.ok) {
    console.error('[api/visit] start write failed:', result.code, result.detail);
    return NextResponse.json({ ok: false, error: result.code }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
