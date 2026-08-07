// Application module for POST /api/interaction — T15 (Spec C2).
//
// Handler -> application module (here) -> data adapter, per
// backend-standards. The route owns rate-limiting, JSON/schema
// validation, and the consent gate; this module owns the one business
// rule (resolve the session row, then write the interaction row) and
// the adapter call.
//
// candidate_interactions has a public INSERT policy (migration 005:
// "Public insert interactions" WITH CHECK true) — anon client is
// correct, no service-role needed.

import 'server-only';
import { getAnonClient } from '@/lib/data/adapter-anon';
import { resolveSessionRowId } from './session';
import { mapWriteError } from './errors';
import type { InteractionAction } from '@/types/database';

export interface RecordInteractionInput {
  sessionToken: string;
  candidateId: string;
  raceId: string;
  action: InteractionAction;
  viewOrder?: number | null;
  dwellMs?: number | null;
}

export type RecordInteractionResult =
  | { ok: true }
  | { ok: false; code: 'session_unavailable' | 'invalid_reference' | 'write_failed'; status: number; detail?: string };

export async function recordInteraction(
  input: RecordInteractionInput,
): Promise<RecordInteractionResult> {
  const sessionRowId = await resolveSessionRowId(input.sessionToken);
  if (!sessionRowId) {
    return { ok: false, code: 'session_unavailable', status: 500 };
  }

  const { error } = await getAnonClient().from('candidate_interactions').insert({
    session_id: sessionRowId,
    candidate_id: input.candidateId,
    race_id: input.raceId,
    action: input.action,
    view_order: input.viewOrder ?? null,
    dwell_ms: input.dwellMs ?? null,
  });

  if (error) {
    const mapped = mapWriteError(error);
    return { ok: false, code: mapped.code, status: mapped.status, detail: mapped.detail };
  }

  return { ok: true };
}
