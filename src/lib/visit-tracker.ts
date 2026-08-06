// In-memory store for consent_audit.
//
// session_visits persistence moved to src/lib/app/visits.ts (T15, Spec
// C2) — real INSERT/UPDATE against the Supabase `session_visits` table
// instead of this process-memory array. consent_audit stays in-memory:
// it is written from /api/consent (not owned by this ticket) and isn't
// one of the four T15 target tables (candidate_interactions,
// quick_poll_responses, session_visits, llm_matches). Wiring
// consent_audit to Supabase is out of scope here.

import type { ConsentEvent, ConsentType } from '@/types/database';

// ============================================================
// Stores (process-memory only; restart wipes them)
// ============================================================

const consentAuditStore: ConsentEvent[] = [];

// ============================================================
// consent_audit (immutable)
// ============================================================

interface RecordConsentInput {
  session_id: string;
  consent_type: ConsentType;
  granted: boolean;
  ip_hash?: string | null;
  user_agent_hash?: string | null;
}

export function auditConsent(input: RecordConsentInput): ConsentEvent {
  const event: ConsentEvent = {
    id: crypto.randomUUID(),
    session_id: input.session_id,
    consent_type: input.consent_type,
    granted: input.granted,
    granted_at: new Date().toISOString(),
    ip_hash: input.ip_hash ?? null,
    user_agent_hash: input.user_agent_hash ?? null,
  };
  consentAuditStore.push(event);
  return event;
}

export function getConsentHistory(session_id: string): ConsentEvent[] {
  return consentAuditStore.filter((c) => c.session_id === session_id);
}

/**
 * Anonymize the consent-audit trail for a session (right-to-delete).
 * `session_id` here is the raw voter_session cookie token — the same
 * value /api/consent's auditConsent call keys entries by.
 *
 * Per CCPA, audit records of consent grants/revokes can be retained for
 * compliance. But the user has the right to delete the LINK between
 * those records and themselves, so we null the session_id (replace with
 * the literal 'PURGED') instead of deleting the row.
 *
 * The real-table deletes (candidate_interactions, quick_poll_responses,
 * session_visits, llm_matches) live in src/lib/app/data-rights.ts —
 * this function only ever touches the in-memory consent_audit stub.
 */
export function purgeConsentAudit(session_id: string): { consent_events: number } {
  let auditCount = 0;
  for (const event of consentAuditStore) {
    if (event.session_id === session_id) {
      (event as { session_id: string }).session_id = 'PURGED';
      auditCount += 1;
    }
  }
  return { consent_events: auditCount };
}
