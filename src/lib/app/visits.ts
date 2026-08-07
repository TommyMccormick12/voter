// Application module for POST /api/visit — T15 (Spec C2).
//
// Replaces the in-memory visitStore in src/lib/visit-tracker.ts (which
// now only keeps the unrelated consent_audit stub — see that file's
// header comment). Same open/close-visit logic as before, moved onto
// `session_visits` rows instead of a process-memory array.
//
// session_visits has a public INSERT + SELECT policy (migration 005:
// "Public insert visits" / "Public read visits", both WITH
// CHECK/USING true) — anon client is correct for those two. There is
// NO UPDATE policy on session_visits anywhere in the migrations. An
// anon-client UPDATE against this table therefore matches zero rows,
// and PostgREST reports that as an ordinary success — pages_viewed and
// visit_ended_at would silently never change. Adding an anon UPDATE
// policy is not the fix: with no ownership check possible from the
// shared anon key, it would let any client rewrite any visit row. The
// correct scope is server-side service-role, which is safe here
// because this module is server-only (`import 'server-only'` below)
// and is only ever reached from the /api/visit route handler.

import 'server-only';
import { getAnonClient } from '@/lib/data/adapter-anon';
import { getServiceClient } from '@/lib/data/adapter-service';
import { resolveSessionRowId } from './session';
import { mapWriteError } from './errors';

const STALE_VISIT_MS = 30 * 60 * 1000; // 30 min idle = new visit

export type VisitResult =
  | { ok: true }
  | { ok: false; code: 'session_unavailable' | 'invalid_reference' | 'write_failed'; status: number; detail?: string };

interface OpenVisitRow {
  id: string;
  visit_started_at: string | null;
  pages_viewed: number | null;
}

async function findOpenVisit(
  sb: ReturnType<typeof getAnonClient>,
  sessionRowId: string,
): Promise<{ data: OpenVisitRow | null; error: { message: string } | null }> {
  const { data, error } = await sb
    .from('session_visits')
    .select('id, visit_started_at, pages_viewed')
    .eq('session_id', sessionRowId)
    .is('visit_ended_at', null)
    .order('visit_started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { data: data ?? null, error };
}

/**
 * Turn a service-role `.update(...).select('id')` result into a
 * VisitResult, treating "no error, but zero rows matched" as a real
 * failure rather than a silent success. With no UPDATE policy on
 * session_visits, only the service-role client reaches this code path,
 * so an empty result here means the row (or its id) was wrong — never
 * an RLS mismatch — and callers should surface it as a write failure.
 */
function toUpdateResult(
  data: { id: string }[] | null,
  error: { message: string; code?: string } | null,
): VisitResult {
  if (error) {
    const mapped = mapWriteError(error);
    return { ok: false, code: mapped.code, status: mapped.status, detail: mapped.detail };
  }
  if (!data || data.length === 0) {
    return { ok: false, code: 'write_failed', status: 500, detail: 'session_visits update matched no rows' };
  }
  return { ok: true };
}

export interface RecordPageViewInput {
  sessionToken: string;
  ipCountry: string | null;
  ipRegion: string | null;
  userAgentHash: string | null;
}

/**
 * Increment pages_viewed on the most recent open visit for a session,
 * or open a new visit if none is active or the last one is stale.
 */
export async function recordPageView(input: RecordPageViewInput): Promise<VisitResult> {
  const sb = getAnonClient();
  const sessionRowId = await resolveSessionRowId(input.sessionToken);
  if (!sessionRowId) {
    return { ok: false, code: 'session_unavailable', status: 500 };
  }

  const { data: open, error: findErr } = await findOpenVisit(sb, sessionRowId);
  if (findErr) {
    return { ok: false, code: 'write_failed', status: 500, detail: findErr.message };
  }

  const now = new Date();
  if (open) {
    // A null visit_started_at shouldn't happen (column has a DB default),
    // but treat it as maximally stale rather than crash on `new Date(null)`
    // (which parses to the epoch and would read as "not stale" — the
    // opposite of the safe default here).
    const stale = open.visit_started_at
      ? now.getTime() - new Date(open.visit_started_at).getTime() > STALE_VISIT_MS
      : true;
    if (!stale) {
      const { data, error } = await getServiceClient()
        .from('session_visits')
        .update({ pages_viewed: (open.pages_viewed ?? 0) + 1 })
        .eq('id', open.id)
        .select('id');
      return toUpdateResult(data, error);
    }
    // Close the stale visit before opening a new one. A failed or no-op
    // close is a real failure (see toUpdateResult) — surface it instead
    // of silently opening a second concurrent "open" visit row.
    const { data: closeData, error: closeError } = await getServiceClient()
      .from('session_visits')
      .update({ visit_ended_at: now.toISOString() })
      .eq('id', open.id)
      .select('id');
    const closeResult = toUpdateResult(closeData, closeError);
    if (!closeResult.ok) {
      return closeResult;
    }
  }

  const { error: insertErr } = await sb.from('session_visits').insert({
    session_id: sessionRowId,
    visit_started_at: now.toISOString(),
    pages_viewed: 1,
    ip_country: input.ipCountry,
    ip_region: input.ipRegion,
    user_agent_hash: input.userAgentHash,
  });
  if (insertErr) {
    const mapped = mapWriteError(insertErr);
    return { ok: false, code: mapped.code, status: mapped.status, detail: mapped.detail };
  }
  return { ok: true };
}

/** Close the most recent open visit for a session (beforeunload / pagehide flush). */
export async function endVisit(sessionToken: string): Promise<VisitResult> {
  const sb = getAnonClient();
  const sessionRowId = await resolveSessionRowId(sessionToken);
  if (!sessionRowId) {
    return { ok: false, code: 'session_unavailable', status: 500 };
  }

  const { data: open, error: findErr } = await findOpenVisit(sb, sessionRowId);
  if (findErr) {
    return { ok: false, code: 'write_failed', status: 500, detail: findErr.message };
  }
  if (!open) {
    // Nothing open — idempotent no-op success (matches the prior
    // in-memory endVisit's "return null if none" behavior, but the API
    // contract here is success/failure, not the closed row).
    return { ok: true };
  }

  const { data, error } = await getServiceClient()
    .from('session_visits')
    .update({ visit_ended_at: new Date().toISOString() })
    .eq('id', open.id)
    .select('id');
  return toUpdateResult(data, error);
}
