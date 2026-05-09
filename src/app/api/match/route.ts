import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { matchCandidates } from '@/lib/llm/match';
import { getMockCandidatesForRace, getMockRace } from '@/lib/mock-data';

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
 * TODO (Chunk 5/6):
 *  - Persist response to llm_matches table for cache + analytics
 *  - Rate-limit by session_id (10/hr) and IP (30/hr) via cookie + middleware
 *  - Gate on consent_analytics for free_text storage
 *
 * Cost control:
 *  - In-memory cache by (free_text + race_id) hash
 *  - MATCH_API_DISABLED=true env var as kill switch
 */
export async function POST(request: NextRequest) {
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

  // TODO (Chunk 6): swap mock-data for Supabase race+candidates lookup.
  const race = getMockRace(race_id);
  if (!race) {
    return NextResponse.json(
      { ok: false, error: 'race_not_found' },
      { status: 404 }
    );
  }

  const candidates = getMockCandidatesForRace(race_id);
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
