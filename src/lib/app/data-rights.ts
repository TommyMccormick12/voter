// Application module for GET/DELETE /api/data-rights — T15 (Spec C2).
//
// Right-to-know export + right-to-delete purge, scoped to the
// requesting session. Session ownership is derived server-side from
// the httpOnly voter_session cookie only — never from a client-supplied
// id — so this can't be used to read or delete another session's data.
//
// Service-role client for ALL FOUR tables here, justified two ways:
//   1. llm_matches has NO public policy at all (migration 005: "server-
//      only ... cache lookup goes through API") — both read and delete
//      require RLS-bypass regardless.
//   2. candidate_interactions / quick_poll_responses / session_visits
//      have public INSERT + SELECT policies but no DELETE policy
//      (migration 005 only defines Insert/Select) — so the delete side
//      needs service-role no matter what. Using service-role for the
//      paired read keeps one client for the whole subsystem instead of
//      splitting "read via anon, delete via service" per table.
// The service-role key never reaches the client — this module is
// server-only and only called from the /api/data-rights route handler.

import 'server-only';
import { getServiceClient } from '@/lib/data/adapter-service';
import { lookupSessionRowId } from './session';

export interface InteractionExport {
  id: string;
  candidate_id: string | null;
  race_id: string | null;
  action: string;
  view_order: number | null;
  dwell_ms: number | null;
  created_at: string | null;
}

export interface QuickPollExport {
  id: string;
  race_id: string | null;
  issue_id: string | null;
  weight: number;
  created_at: string | null;
}

export interface VisitExport {
  id: string;
  visit_started_at: string | null;
  visit_ended_at: string | null;
  pages_viewed: number | null;
  ip_country: string | null;
  ip_region: string | null;
}

export interface LlmMatchExport {
  id: string;
  race_id: string | null;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string | null;
}

export interface SessionDataExport {
  sessionExists: boolean;
  interactions: InteractionExport[];
  quickPollResponses: QuickPollExport[];
  visits: VisitExport[];
  matches: LlmMatchExport[];
}

export type ExportResult =
  | { ok: true; data: SessionDataExport }
  | { ok: false; code: 'read_failed'; status: 500; detail: string };

/** GET path: read every row across the four T15 tables for this session. */
export async function exportSessionData(sessionToken: string): Promise<ExportResult> {
  const sessionRowId = await lookupSessionRowId(sessionToken);
  if (!sessionRowId) {
    // No sessions row for this token yet == nothing has been written for
    // it. Honest empty state, not an error.
    return {
      ok: true,
      data: { sessionExists: false, interactions: [], quickPollResponses: [], visits: [], matches: [] },
    };
  }

  const sb = getServiceClient();
  const [interactionsRes, pollRes, visitsRes, matchesRes] = await Promise.all([
    sb
      .from('candidate_interactions')
      .select('id, candidate_id, race_id, action, view_order, dwell_ms, created_at')
      .eq('session_id', sessionRowId),
    sb
      .from('quick_poll_responses')
      .select('id, race_id, issue_id, weight, created_at')
      .eq('session_id', sessionRowId),
    sb
      .from('session_visits')
      .select('id, visit_started_at, visit_ended_at, pages_viewed, ip_country, ip_region')
      .eq('session_id', sessionRowId),
    sb
      .from('llm_matches')
      .select('id, race_id, model, input_tokens, output_tokens, created_at')
      .eq('session_id', sessionRowId),
  ]);

  for (const res of [interactionsRes, pollRes, visitsRes, matchesRes]) {
    if (res.error) {
      console.error('[app/data-rights] export read failed:', res.error.message);
      return { ok: false, code: 'read_failed', status: 500, detail: res.error.message };
    }
  }

  return {
    ok: true,
    data: {
      sessionExists: true,
      interactions: interactionsRes.data ?? [],
      quickPollResponses: pollRes.data ?? [],
      visits: visitsRes.data ?? [],
      // free_text is deliberately excluded from the export select list —
      // right-to-know doesn't require re-surfacing the user's own raw
      // input back through a JSON export whose id fields include model
      // names; ranked_candidates/free_text stay server-side.
      matches: matchesRes.data ?? [],
    },
  };
}

export interface PurgeCounts {
  interactions: number;
  quickPollResponses: number;
  visits: number;
  matches: number;
  sessions: number;
}

export type DeleteResult =
  | { ok: true; purged: PurgeCounts }
  | { ok: false; code: 'delete_failed'; status: 500; detail: string };

/**
 * DELETE path: remove every row across the four T15 behavior tables for
 * this session, then delete the `sessions` row itself.
 *
 * The four child deletes alone are not a full right-to-delete purge:
 * the `sessions` row (session_token, zip, utm_*, referrer_domain,
 * device_type) survives them, and `candidate_reports.session_id` stays
 * linked to it. `sessions` is the identity row, so it is deleted last
 * on the same service-role client — never the anon client, even though
 * `sessions` has a public UPDATE policy (migration 002), because
 * deleting the row that anchors this whole subsystem should not depend
 * on an RLS policy staying permissive.
 *
 * Deleting `sessions` also cascades: candidate_interactions,
 * quick_poll_responses, session_visits, and llm_matches all
 * REFERENCES sessions(id) ON DELETE CASCADE (migration 004), and
 * candidate_reports.session_id is ON DELETE SET NULL (migration 009),
 * so the sessions delete alone would sever every link. The four child
 * deletes still run first, explicitly, so the returned purge counts
 * stay accurate per table instead of collapsing into one cascade count.
 */
export async function deleteSessionData(sessionToken: string): Promise<DeleteResult> {
  const sessionRowId = await lookupSessionRowId(sessionToken);
  if (!sessionRowId) {
    return { ok: true, purged: { interactions: 0, quickPollResponses: 0, visits: 0, matches: 0, sessions: 0 } };
  }

  const sb = getServiceClient();
  const [interactionsRes, pollRes, visitsRes, matchesRes] = await Promise.all([
    sb.from('candidate_interactions').delete({ count: 'exact' }).eq('session_id', sessionRowId),
    sb.from('quick_poll_responses').delete({ count: 'exact' }).eq('session_id', sessionRowId),
    sb.from('session_visits').delete({ count: 'exact' }).eq('session_id', sessionRowId),
    // llm_matches rows can be shared across sessions via the
    // (free_text_hash, race_id) cache (a second session that typed the
    // identical free text for the same race gets a cache hit on the
    // first session's row, with no row of its own). We only delete rows
    // this session actually created (session_id = its own row) — not
    // every row this session ever *read* via a cache hit, which would
    // delete another session's data out from under them.
    sb.from('llm_matches').delete({ count: 'exact' }).eq('session_id', sessionRowId),
  ]);

  for (const res of [interactionsRes, pollRes, visitsRes, matchesRes]) {
    if (res.error) {
      console.error('[app/data-rights] delete failed:', res.error.message);
      return { ok: false, code: 'delete_failed', status: 500, detail: res.error.message };
    }
  }

  const sessionsRes = await sb.from('sessions').delete({ count: 'exact' }).eq('id', sessionRowId);
  if (sessionsRes.error) {
    console.error('[app/data-rights] session identity delete failed:', sessionsRes.error.message);
    return { ok: false, code: 'delete_failed', status: 500, detail: sessionsRes.error.message };
  }

  return {
    ok: true,
    purged: {
      interactions: interactionsRes.count ?? 0,
      quickPollResponses: pollRes.count ?? 0,
      visits: visitsRes.count ?? 0,
      matches: matchesRes.count ?? 0,
      sessions: sessionsRes.count ?? 0,
    },
  };
}
