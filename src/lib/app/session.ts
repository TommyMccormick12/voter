// Session-row resolution — T15 (Spec C2).
//
// The `voter_session` httpOnly cookie holds a bare token string (see
// src/lib/cookies.ts generateSessionToken). Every write table this
// ticket wires (candidate_interactions, quick_poll_responses,
// session_visits, llm_matches) foreign-keys `session_id` to
// `sessions(id)` — a uuid — not to the token string itself (migrations
// 001/004). So every write needs the token resolved (or lazily
// created) into a `sessions` row before it can satisfy that FK.
//
// This mirrors the existing client-side lookup in src/lib/session.ts
// (the legacy localStorage path, same `sessions` table, same
// get-or-create shape) — T21/E1 retires that path later, but the table
// contract is shared today.
//
// Anon client is correct here: migration 002 grants public
// insert/select/update on `sessions` ("Insert sessions", "Select
// sessions", "Update sessions", all WITH CHECK/USING true).

import 'server-only';
import { getAnonClient } from '@/lib/data/adapter-anon';

/**
 * Resolve the `sessions.id` row for a cookie token, creating the row
 * if this is the first server-side write for that token. Returns null
 * (never throws) on a Supabase error — callers treat that as a typed
 * write failure, not a fake success.
 */
export async function resolveSessionRowId(sessionToken: string): Promise<string | null> {
  const existingId = await lookupSessionRowId(sessionToken);
  if (existingId) return existingId;

  const { data, error } = await getAnonClient()
    .from('sessions')
    .insert({ session_token: sessionToken })
    .select('id')
    .single();

  if (error) {
    // Unique-violation on session_token means a concurrent request already
    // created the row (two tabs, same new visitor). Look it up instead of
    // failing the write.
    if (error.code === '23505') {
      return lookupSessionRowId(sessionToken);
    }
    console.error('[app/session] failed to create session row:', error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Look up the `sessions.id` row for a cookie token WITHOUT creating one.
 * Used by read/delete paths (data-rights, match-by-id ownership check)
 * where "no row yet" legitimately means "this session has no data" —
 * not something to a create a row for.
 */
export async function lookupSessionRowId(sessionToken: string): Promise<string | null> {
  const { data, error } = await getAnonClient()
    .from('sessions')
    .select('id')
    .eq('session_token', sessionToken)
    .maybeSingle();

  if (error) {
    console.error('[app/session] session lookup failed:', error.message);
    return null;
  }
  return data?.id ?? null;
}
