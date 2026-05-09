// In-memory store for session_visits + consent_audit until Chunk 6 wires
// these to the corresponding Supabase tables. All writes here are
// consent-gated upstream by the API routes that call into them.
//
// Schema mirrors migration 004 / 005 exactly so the swap is mechanical:
//   src/lib/visit-tracker.ts (memory) → SELECT/INSERT into session_visits
//   src/lib/visit-tracker.ts auditConsent → INSERT into consent_audit

import type {
  ConsentEvent,
  ConsentType,
  SessionVisit,
} from '@/types/database';

// ============================================================
// Stores (process-memory only; restart wipes them)
// ============================================================

const visitStore: SessionVisit[] = [];
const consentAuditStore: ConsentEvent[] = [];

// ============================================================
// session_visits
// ============================================================

interface RecordVisitInput {
  session_id: string;
  ip_country?: string | null;
  ip_region?: string | null;
  user_agent_hash?: string | null;
}

export function recordVisitStart(input: RecordVisitInput): SessionVisit {
  const visit: SessionVisit = {
    id: crypto.randomUUID(),
    session_id: input.session_id,
    visit_started_at: new Date().toISOString(),
    visit_ended_at: null,
    pages_viewed: 1,
    ip_country: input.ip_country ?? null,
    ip_region: input.ip_region ?? null,
    user_agent_hash: input.user_agent_hash ?? null,
  };
  visitStore.push(visit);
  return visit;
}

/**
 * Increment pages_viewed on the most recent open visit for a session,
 * or open a new visit if none is active or the last one is stale (>30 min).
 */
export function recordPageView(input: RecordVisitInput): SessionVisit {
  const recent = lastOpenVisit(input.session_id);
  if (recent && !isStale(recent)) {
    recent.pages_viewed += 1;
    return recent;
  }
  // Close stale visits before opening a new one
  if (recent) recent.visit_ended_at = new Date().toISOString();
  return recordVisitStart(input);
}

export function endVisit(session_id: string): SessionVisit | null {
  const recent = lastOpenVisit(session_id);
  if (!recent) return null;
  recent.visit_ended_at = new Date().toISOString();
  return recent;
}

export function getVisitsForSession(session_id: string): SessionVisit[] {
  return visitStore.filter((v) => v.session_id === session_id);
}

function lastOpenVisit(session_id: string): SessionVisit | null {
  for (let i = visitStore.length - 1; i >= 0; i--) {
    const v = visitStore[i];
    if (v.session_id === session_id && v.visit_ended_at === null) return v;
  }
  return null;
}

function isStale(visit: SessionVisit): boolean {
  const ageMs = Date.now() - new Date(visit.visit_started_at).getTime();
  return ageMs > 30 * 60 * 1000; // 30 min idle = new visit
}

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
 * Delete all data for a session. Used by the right-to-delete endpoint.
 * Returns counts of what was removed.
 */
export function purgeSession(session_id: string): { visits: number; consent_events: number } {
  const visitCount = countAndRemove(visitStore, (v) => v.session_id === session_id);
  // Note: per CCPA, audit records of consent grants/revokes can be retained
  // for compliance. But the user has the right to delete the LINK between
  // those records and themselves. We null the session_id on remaining audit
  // entries instead of deleting them.
  let auditCount = 0;
  for (const event of consentAuditStore) {
    if (event.session_id === session_id) {
      // Anonymize: replace session_id with the literal string 'PURGED'.
      // Keeps the audit row for regulator inspection but breaks the link.
      (event as { session_id: string }).session_id = 'PURGED';
      auditCount += 1;
    }
  }
  return { visits: visitCount, consent_events: auditCount };
}

function countAndRemove<T>(arr: T[], pred: (v: T) => boolean): number {
  let removed = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) {
      arr.splice(i, 1);
      removed += 1;
    }
  }
  return removed;
}
