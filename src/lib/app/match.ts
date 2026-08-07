// Application module for POST /api/match + /match/results — T15/T17
// (Spec C2/C4).
//
// Two operations:
//   - runMatch: compute (or DB-cache-hit) a ranking and persist it to
//     llm_matches. Both the Haiku path and the heuristic-fallback path
//     persist — the row's `model` column records which one produced it.
//   - getMatchById: server-side lookup for /match/results?m=<id>,
//     replacing the sessionStorage transport (T17). Ownership-checked
//     against the requesting session's cookie.
//
// llm_matches has NO public policy (migration 005: "server-only ...
// cache lookup goes through API") — every access here uses the
// service-role client. That is the one service-role use in this
// module; justified because there is no RLS path that would let the
// anon client read or write this table at all.

import 'server-only';
import { getServiceClient } from '@/lib/data/adapter-service';
import {
  matchCandidates,
  hashFreeText,
  HAIKU_MODEL_LABEL,
  MOCK_MODEL_LABEL,
  type QuickPollWeight,
} from '@/lib/llm/match';
import { resolveSessionRowId, lookupSessionRowId } from './session';
import type { CandidateWithFullData, MatchResult } from '@/types/database';
import type { Json } from '@/types/supabase';

export interface MatchMeta {
  cache_hit: boolean;
  /** 'mock' means the heuristic fallback — the UI must label this "estimated match". */
  source: 'haiku' | 'mock';
  input_tokens?: number;
  output_tokens?: number;
}

export interface RunMatchInput {
  sessionToken: string | null;
  raceId: string;
  freeText: string;
  quickPoll?: QuickPollWeight[];
  candidates: CandidateWithFullData[];
  /**
   * Gate from the caller's consent.analytics read (Finding 1). Matching
   * itself must work with no consent — this flag only controls whether
   * the persisted row carries session_id / free_text. Absent consent
   * (no cookie yet) must arrive here as false, same as the sibling
   * /api/interaction and /api/quick-poll routes.
   */
  hasAnalyticsConsent: boolean;
}

export type RunMatchResult =
  | { ok: true; id: string; ranked: MatchResult[]; meta: MatchMeta; freeTextHash: string }
  | { ok: false; code: 'match_failed' | 'persist_failed'; status: number; detail?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function modelForSource(source: 'haiku' | 'mock'): string {
  return source === 'mock' ? MOCK_MODEL_LABEL : HAIKU_MODEL_LABEL;
}

function sourceForModel(model: string): 'haiku' | 'mock' {
  return model === MOCK_MODEL_LABEL ? 'mock' : 'haiku';
}

/**
 * Compute (or DB-cache-hit) a ranking for free_text+race_id, then
 * persist it. The llm_matches unique index is on (free_text_hash,
 * race_id) — checking it FIRST avoids a Haiku call entirely on a
 * cache hit (the cost-control contract from AGENTS.md), and the
 * subsequent upsert makes concurrent identical requests safe (Postgres
 * ON CONFLICT DO UPDATE, not a unique-violation error).
 */
export async function runMatch(input: RunMatchInput): Promise<RunMatchResult> {
  const sb = getServiceClient();
  const freeTextHash = hashFreeText(input.freeText, input.raceId);

  const { data: existing, error: lookupErr } = await sb
    .from('llm_matches')
    .select('id, model, input_tokens, output_tokens, ranked_candidates')
    .eq('free_text_hash', freeTextHash)
    .eq('race_id', input.raceId)
    .maybeSingle();

  if (lookupErr) {
    // A cache-read hiccup isn't fatal — fall through and compute fresh
    // rather than failing the whole request over a read-only lookup.
    console.error('[app/match] cache lookup failed:', lookupErr.message);
  } else if (existing) {
    return {
      ok: true,
      id: existing.id,
      ranked: existing.ranked_candidates as unknown as MatchResult[],
      freeTextHash,
      meta: {
        cache_hit: true,
        source: sourceForModel(existing.model),
        input_tokens: existing.input_tokens ?? undefined,
        output_tokens: existing.output_tokens ?? undefined,
      },
    };
  }

  let result;
  try {
    result = await matchCandidates({
      free_text: input.freeText,
      race_id: input.raceId,
      candidates: input.candidates,
      quick_poll: input.quickPoll,
    });
  } catch (err) {
    return {
      ok: false,
      code: 'match_failed',
      status: 500,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // Finding 1: matching works with no consent, but the persisted row must
  // carry nothing identity-linked or sensitive when consent is absent —
  // session_id stays null and free_text stays ''. free_text_hash (the
  // cache key) and ranked_candidates always persist either way, so the
  // row stays functional for results transport and admin spend stats.
  // Skip resolveSessionRowId entirely without consent — no reason to
  // create/touch a sessions row for a write that will end up null anyway.
  const sessionRowId =
    input.hasAnalyticsConsent && input.sessionToken
      ? await resolveSessionRowId(input.sessionToken)
      : null;

  // Finding 3: ON CONFLICT DO NOTHING (ignoreDuplicates), never DO UPDATE.
  // A concurrent identical request must never rewrite an existing row's
  // session_id — that would transfer ownership and break the prior
  // owner's saved link. When this upsert inserts nothing, select the
  // survivor by the same natural key and use its id instead.
  const { data: inserted, error: insertErr } = await sb
    .from('llm_matches')
    .upsert(
      {
        session_id: sessionRowId,
        free_text: input.hasAnalyticsConsent ? input.freeText : '',
        free_text_hash: freeTextHash,
        race_id: input.raceId,
        model: modelForSource(result.source),
        input_tokens: result.input_tokens ?? null,
        output_tokens: result.output_tokens ?? null,
        ranked_candidates: result.ranked as unknown as Json,
      },
      { onConflict: 'free_text_hash,race_id', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle();

  if (insertErr) {
    // The sanctioned "fake success" exception is ONLY the heuristic
    // ranking itself (labeled 'mock'). A genuine persistence failure
    // must surface as an error — /match/results needs the returned id
    // (T17), and a silent-success-with-no-id would break deep-linking.
    return {
      ok: false,
      code: 'persist_failed',
      status: 500,
      detail: insertErr.message,
    };
  }

  let matchId = inserted?.id ?? null;

  if (!matchId) {
    // ignoreDuplicates inserted nothing — a row for this
    // (free_text_hash, race_id) already existed. Look up its id rather
    // than trusting a locally-computed one; it may belong to a
    // concurrent request that just won the race.
    const { data: existingRow, error: selectErr } = await sb
      .from('llm_matches')
      .select('id')
      .eq('free_text_hash', freeTextHash)
      .eq('race_id', input.raceId)
      .maybeSingle();

    if (selectErr || !existingRow) {
      return {
        ok: false,
        code: 'persist_failed',
        status: 500,
        detail: selectErr?.message ?? 'row missing after ignored-duplicate upsert',
      };
    }
    matchId = existingRow.id;
  }

  return {
    ok: true,
    id: matchId,
    ranked: result.ranked,
    freeTextHash,
    meta: {
      cache_hit: false,
      source: result.source,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
    },
  };
}

export interface StoredMatch {
  id: string;
  raceId: string;
  freeText: string;
  ranked: MatchResult[];
  meta: MatchMeta;
}

export type GetMatchResult =
  | { ok: true; match: StoredMatch }
  | { ok: false; code: 'not_found' | 'forbidden' | 'server_error'; status: number };

/**
 * Server-side lookup for /match/results?m=<id> (T17 — replaces the
 * sessionStorage transport). The cache lookup in runMatch is global
 * (keyed only on free_text_hash + race_id, no session filter — that's
 * what lets it save a Haiku call across sessions), so a cache hit can
 * return a row another session owns. Finding 2/3's allow rule handles
 * that instead of 403ing a legitimate cache hit:
 *
 *   (a) row.session_id is null (no consent at persist time, Finding 1), or
 *   (b) row.session_id matches the requester's own resolved session row, or
 *   (c) the caller supplies `hash` equal to row.free_text_hash — proof
 *       they know the exact input text (they could regenerate the same
 *       ranking from scratch anyway, so this reveals nothing they
 *       couldn't already get).
 *
 * free_text is a different question from access: even when (a) or (c)
 * grants access to the row, this never returns another owner's
 * free_text — only case (b), the requester's own session, does. Callers
 * (the results page/component) get '' for free_text in cases (a)/(c).
 */
export async function getMatchById(
  matchId: string,
  sessionToken: string | null,
  hash?: string | null,
): Promise<GetMatchResult> {
  if (!UUID_RE.test(matchId)) {
    return { ok: false, code: 'not_found', status: 404 };
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from('llm_matches')
    .select(
      'id, race_id, session_id, free_text, free_text_hash, model, input_tokens, output_tokens, ranked_candidates',
    )
    .eq('id', matchId)
    .maybeSingle();

  if (error) {
    console.error('[app/match] getMatchById failed:', error.message);
    return { ok: false, code: 'server_error', status: 500 };
  }
  if (!data) {
    return { ok: false, code: 'not_found', status: 404 };
  }

  let allowed = false;
  let isOwner = false;

  if (!data.session_id) {
    // Case (a).
    allowed = true;
  } else {
    const sessionRowId = sessionToken ? await lookupSessionRowId(sessionToken) : null;
    if (sessionRowId === data.session_id) {
      // Case (b).
      allowed = true;
      isOwner = true;
    } else if (hash && hash === data.free_text_hash) {
      // Case (c).
      allowed = true;
    }
  }

  if (!allowed) {
    return { ok: false, code: 'forbidden', status: 403 };
  }

  return {
    ok: true,
    match: {
      id: data.id,
      raceId: data.race_id ?? '',
      freeText: isOwner ? data.free_text : '',
      ranked: data.ranked_candidates as unknown as MatchResult[],
      meta: {
        cache_hit: false,
        source: sourceForModel(data.model),
        input_tokens: data.input_tokens ?? undefined,
        output_tokens: data.output_tokens ?? undefined,
      },
    },
  };
}
