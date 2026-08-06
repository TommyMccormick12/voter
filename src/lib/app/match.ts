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
}

export type RunMatchResult =
  | { ok: true; id: string; ranked: MatchResult[]; meta: MatchMeta }
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

  const sessionRowId = input.sessionToken ? await resolveSessionRowId(input.sessionToken) : null;

  const { data: inserted, error: insertErr } = await sb
    .from('llm_matches')
    .upsert(
      {
        session_id: sessionRowId,
        free_text: input.freeText,
        free_text_hash: freeTextHash,
        race_id: input.raceId,
        model: modelForSource(result.source),
        input_tokens: result.input_tokens ?? null,
        output_tokens: result.output_tokens ?? null,
        ranked_candidates: result.ranked as unknown as Json,
      },
      { onConflict: 'free_text_hash,race_id' },
    )
    .select('id')
    .single();

  if (insertErr || !inserted) {
    // The sanctioned "fake success" exception is ONLY the heuristic
    // ranking itself (labeled 'mock'). A genuine persistence failure
    // must surface as an error — /match/results needs the returned id
    // (T17), and a silent-success-with-no-id would break deep-linking.
    return {
      ok: false,
      code: 'persist_failed',
      status: 500,
      detail: insertErr?.message,
    };
  }

  return {
    ok: true,
    id: inserted.id,
    ranked: result.ranked,
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
 * sessionStorage transport). Ownership check: if the row has a
 * session_id, it must match the requesting session's row id, or this
 * returns 'forbidden'. Rows with a null session_id (edge case — no
 * session cookie was available at persist time) are readable by anyone
 * holding the id, same as before.
 *
 * A same-session refresh or deep link always passes: the cookie is
 * stable across reloads, so the resolved session row id matches. A
 * link shared with a different browser/session is rejected — separate
 * from /share, which deliberately publishes race+candidate+score
 * without free_text and needs no ownership check.
 */
export async function getMatchById(
  matchId: string,
  sessionToken: string | null,
): Promise<GetMatchResult> {
  if (!UUID_RE.test(matchId)) {
    return { ok: false, code: 'not_found', status: 404 };
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from('llm_matches')
    .select('id, race_id, session_id, free_text, model, input_tokens, output_tokens, ranked_candidates')
    .eq('id', matchId)
    .maybeSingle();

  if (error) {
    console.error('[app/match] getMatchById failed:', error.message);
    return { ok: false, code: 'server_error', status: 500 };
  }
  if (!data) {
    return { ok: false, code: 'not_found', status: 404 };
  }

  if (data.session_id) {
    const sessionRowId = sessionToken ? await lookupSessionRowId(sessionToken) : null;
    if (sessionRowId !== data.session_id) {
      return { ok: false, code: 'forbidden', status: 403 };
    }
  }

  return {
    ok: true,
    match: {
      id: data.id,
      raceId: data.race_id ?? '',
      freeText: data.free_text,
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
