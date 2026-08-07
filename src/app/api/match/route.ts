import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { runMatch } from '@/lib/app/match';
import { getRace } from '@/lib/data/races';
import { getCandidatesForRace } from '@/lib/data/candidates';
import { COOKIE_NAMES, readCookie } from '@/lib/cookies';
import { parseConsent } from '@/lib/consent';
import { clientIpFromHeaders } from '@/lib/geo';
import { checkRateLimits, MATCH_LIMITS } from '@/lib/rate-limit';

const RequestSchema = z.object({
  free_text: z.string().min(1).max(2000),
  race_id: z.string().min(1),
  quick_poll: z
    .array(
      z.object({
        issue_slug: z.string().min(1),
        weight: z.number().int().min(1).max(5),
      })
    )
    .optional(),
});

/**
 * POST /api/match
 *
 * Takes user free-text + optional quick-poll weights, returns ranked
 * candidates for the race plus the persisted llm_matches row id (T17 —
 * /match/results?m=<id> fetches by that id instead of sessionStorage).
 * Uses Anthropic Haiku 4.5 if ANTHROPIC_API_KEY is set, otherwise a
 * deterministic local mock ranking; both paths persist via
 * src/lib/app/match.ts, which records which one produced the row.
 *
 * Cost control (per /cso Finding 2):
 *  - In-memory rate limit: 10/hr/session, 30/hr/IP (token bucket)
 *  - In-memory cache by (free_text + race_id) hash
 *  - MATCH_API_DISABLED=true env var as kill switch
 *
 * Rate-limit caveat: counters are per Lambda instance. Swap @/lib/rate-limit
 * for Vercel KV / Upstash Redis when traffic warrants distributed counters.
 */
export async function POST(request: NextRequest) {
  // Rate-limit FIRST, before parsing JSON. A spammer should never get to
  // touch the LLM regardless of payload validity.
  const sessionId = (await readCookie(COOKIE_NAMES.session)) ?? null;
  const ip = clientIpFromHeaders(request.headers);
  const rate = await checkRateLimits({
    sessionId,
    ip,
    sessionLimit: MATCH_LIMITS.session,
    ipLimit: MATCH_LIMITS.ip,
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

  const { free_text, race_id, quick_poll } = parsed.data;

  // Consent gate (Finding 1): same read as the sibling /api/interaction
  // and /api/quick-poll routes — absent consent (no cookie yet) counts
  // as no consent. Matching still works without it; the flag only
  // controls whether the persisted llm_matches row carries session_id /
  // free_text (see src/lib/app/match.ts#runMatch).
  const consent = parseConsent(await readCookie(COOKIE_NAMES.consent));
  const hasAnalyticsConsent = consent?.analytics === true;

  const raceResult = await getRace(race_id);
  if (!raceResult.ok) {
    console.error('[api/match] race read failed:', raceResult.error.message);
    return NextResponse.json({ ok: false, error: 'race_read_failed' }, { status: 502 });
  }
  if (!raceResult.data) {
    return NextResponse.json(
      { ok: false, error: 'race_not_found' },
      { status: 404 }
    );
  }

  const candidatesResult = await getCandidatesForRace(race_id);
  if (!candidatesResult.ok) {
    console.error('[api/match] candidates read failed:', candidatesResult.error.message);
    return NextResponse.json({ ok: false, error: 'candidates_read_failed' }, { status: 502 });
  }
  if (candidatesResult.data.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'no_candidates' },
      { status: 404 }
    );
  }

  const result = await runMatch({
    sessionToken: sessionId,
    raceId: race_id,
    freeText: free_text,
    quickPoll: quick_poll,
    candidates: candidatesResult.data,
    hasAnalyticsConsent,
  });

  if (!result.ok) {
    console.error('[api/match] match failed:', result.code, result.detail);
    return NextResponse.json({ ok: false, error: result.code }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    id: result.id,
    // Finding 3 transport: the results page's cache-hit lookup is global
    // (no session filter), so a deep link needs proof-of-knowledge for a
    // row this session doesn't own. free_text_hash lets it get past the
    // 403 without exposing free_text (see getMatchById's case (c)).
    free_text_hash: result.freeTextHash,
    ranked: result.ranked,
    meta: {
      cache_hit: result.meta.cache_hit,
      source: result.meta.source,
      input_tokens: result.meta.input_tokens,
      output_tokens: result.meta.output_tokens,
    },
  });
}
