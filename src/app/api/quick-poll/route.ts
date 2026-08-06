import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { COOKIE_NAMES, readCookie } from '@/lib/cookies';
import { parseConsent } from '@/lib/consent';
import { clientIpFromHeaders } from '@/lib/geo';
import { checkRateLimits, POLL_LIMITS } from '@/lib/rate-limit';
import { recordQuickPoll } from '@/lib/app/quick-poll';

const RequestSchema = z.object({
  race_id: z.string().min(1),
  responses: z
    .array(
      z.object({
        issue_slug: z.string().min(1),
        weight: z.number().int().min(1).max(5),
      })
    )
    .min(1)
    .max(20),
});

/**
 * POST /api/quick-poll
 *
 * Records issue-importance weights from the user's quick poll. Each (issue, weight)
 * tuple becomes a row in quick_poll_responses keyed by session_id and race_id.
 *
 * Flow: this handler validates + gates, then hands off to the
 * application module (src/lib/app/quick-poll.ts), which resolves
 * issue_slug -> issue_id and the session row, then writes
 * quick_poll_responses via the anon adapter. Source data for the B2B
 * district-level issue-weight aggregation product.
 */
export async function POST(request: NextRequest) {
  // Rate limit first — quick-poll responses feed the B2B district-level
  // issue-weight aggregations. Bot stuffing would poison the signal.
  const sessionId = (await readCookie(COOKIE_NAMES.session)) ?? null;
  const ip = clientIpFromHeaders(request.headers);
  const rate = await checkRateLimits({
    sessionId,
    ip,
    sessionLimit: POLL_LIMITS.session,
    ipLimit: POLL_LIMITS.ip,
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

  // No session cookie means nothing to key the rows on — middleware sets
  // voter_session on every request, so this only fires for a
  // hand-crafted request that skipped it.
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: 'no_session' }, { status: 401 });
  }

  // Consent gate. Quick poll feeds the B2B sentiment data product, so it
  // requires consent_data_sale (Tier C) to actually persist. consent_analytics
  // (Tier B) lets us record it for funnel analytics only without selling it.
  const consent = parseConsent(await readCookie(COOKIE_NAMES.consent));
  if (consent && !consent.analytics) {
    return NextResponse.json({ ok: true, dropped: 'consent' });
  }

  const result = await recordQuickPoll({
    sessionToken: sessionId,
    raceId: parsed.data.race_id,
    responses: parsed.data.responses.map((r) => ({ issueSlug: r.issue_slug, weight: r.weight })),
  });

  if (!result.ok) {
    console.error('[api/quick-poll] write failed:', result.code, result.detail ?? result.unknownSlugs);
    return NextResponse.json(
      { ok: false, error: result.code, unknown_issues: result.unknownSlugs },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, recorded: result.recorded });
}
