// Application module for POST /api/visit — T15 (Spec C2).
//
// Replaces the in-memory visitStore in src/lib/visit-tracker.ts (which
// now only keeps the unrelated consent_audit stub — see that file's
// header comment). Same open/close-visit logic as before, moved onto
// `session_visits` rows instead of a process-memory array.
//
// session_visits has a public INSERT + SELECT policy (migration 005:
// "Public insert visits" / "Public read visits", both WITH
// CHECK/USING true) — anon client is correct, no service-role needed.

import 'server-only';
import { getAnonClient } from '@/lib/data/adapter-anon';
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
      const { error } = await sb
        .from('session_visits')
        .update({ pages_viewed: (open.pages_viewed ?? 0) + 1 })
        .eq('id', open.id);
      if (error) {
        const mapped = mapWriteError(error);
        return { ok: false, code: mapped.code, status: mapped.status, detail: mapped.detail };
      }
      return { ok: true };
    }
    // Close the stale visit before opening a new one.
    await sb
      .from('session_visits')
      .update({ visit_ended_at: now.toISOString() })
      .eq('id', open.id);
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

  const { error } = await sb
    .from('session_visits')
    .update({ visit_ended_at: new Date().toISOString() })
    .eq('id', open.id);
  if (error) {
    const mapped = mapWriteError(error);
    return { ok: false, code: mapped.code, status: mapped.status, detail: mapped.detail };
  }
  return { ok: true };
}
