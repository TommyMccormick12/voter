// Application module for POST /api/quick-poll — T15 (Spec C2).
//
// quick_poll_responses.issue_id is a uuid FK to issues(id); the route
// contract takes issue_slug (the stable, human-facing identifier used
// everywhere else in the app). This module resolves slug -> issue_id
// before writing, and rejects unknown slugs as a client error (400) —
// a typo'd or stale slug is a bad payload, not a server failure.
//
// quick_poll_responses has a public INSERT policy (migration 005:
// "Public insert poll responses" WITH CHECK true) — anon client is
// correct, no service-role needed. `issues` has a public SELECT policy
// (migration 001).

import 'server-only';
import { getAnonClient } from '@/lib/data/adapter-anon';
import { resolveSessionRowId } from './session';
import { mapWriteError } from './errors';

export interface QuickPollResponseInput {
  issueSlug: string;
  weight: number;
}

export interface RecordQuickPollInput {
  sessionToken: string;
  raceId: string;
  responses: QuickPollResponseInput[];
}

export type RecordQuickPollResult =
  | { ok: true; recorded: number }
  | {
      ok: false;
      code: 'session_unavailable' | 'unknown_issue' | 'invalid_reference' | 'write_failed';
      status: number;
      detail?: string;
      unknownSlugs?: string[];
    };

export async function recordQuickPoll(
  input: RecordQuickPollInput,
): Promise<RecordQuickPollResult> {
  const sb = getAnonClient();

  const sessionRowId = await resolveSessionRowId(input.sessionToken);
  if (!sessionRowId) {
    return { ok: false, code: 'session_unavailable', status: 500 };
  }

  const slugs = input.responses.map((r) => r.issueSlug);
  const { data: issues, error: issuesErr } = await sb
    .from('issues')
    .select('id, slug')
    .in('slug', slugs);

  if (issuesErr) {
    return { ok: false, code: 'write_failed', status: 500, detail: issuesErr.message };
  }

  const idBySlug = new Map((issues ?? []).map((i) => [i.slug, i.id]));
  const unknownSlugs = slugs.filter((s) => !idBySlug.has(s));
  if (unknownSlugs.length > 0) {
    return { ok: false, code: 'unknown_issue', status: 400, unknownSlugs };
  }

  const rows = input.responses.map((r) => ({
    session_id: sessionRowId,
    race_id: input.raceId,
    issue_id: idBySlug.get(r.issueSlug)!,
    weight: r.weight,
  }));

  const { error } = await sb.from('quick_poll_responses').insert(rows);
  if (error) {
    const mapped = mapWriteError(error);
    return { ok: false, code: mapped.code, status: mapped.status, detail: mapped.detail };
  }

  return { ok: true, recorded: rows.length };
}
