import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { matchCandidates } from '@/lib/llm/match';
import { getRace } from '@/lib/data/races';
import { getCandidatesForRace } from '@/lib/data/candidates';
import { COOKIE_NAMES, readCookie } from '@/lib/cookies';
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
 * candidates for the race. Uses Anthropic Haiku 4.5 if ANTHROPIC_API_KEY
 * is set, otherwise a deterministic local mock ranking.
 *
 * TODO (Chunk 6):
 *  - Persist response to llm_matches table for cache + analytics
 *  - Gate on consent_analytics for free_text storage
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
  const rate = checkRateLimits({
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

  const race = await getRace(race_id);
  if (!race) {
    return NextResponse.json(
      { ok: false, error: 'race_not_found' },
      { status: 404 }
    );
  }

  const candidates = await getCandidatesForRace(race_id);
  if (candidates.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'no_candidates' },
      { status: 404 }
    );
  }

  try {
    const result = await matchCandidates({
      free_text,
      race_id,
      candidates,
      quick_poll,
    });

    return NextResponse.json({
      ok: true,
      ranked: result.ranked,
      meta: {
        cache_hit: result.cache_hit,
        source: result.source,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
      },
    });
  } catch (err) {
    console.error('[api/match] match failed', err);
    return NextResponse.json(
      { ok: false, error: 'match_failed' },
      { status: 500 }
    );
  }
}
