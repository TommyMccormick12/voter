// Contract tests for GET/DELETE /api/data-rights (T15, SPEC-2026-08-06.md C2).
//
// Mocks cookies, src/lib/app/session (session-row resolution — already
// covered by tests/api-interaction.test.ts), the service-role adapter,
// and the in-memory consent-audit helpers in src/lib/visit-tracker.ts
// (untouched by this ticket — see that file's header comment). Exercises
// session-ownership scoping, the four-table read/delete fan-out in
// src/lib/app/data-rights.ts, and error surfacing.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// See tests/api-interaction.test.ts for why 'server-only' needs stubbing here.
vi.mock('server-only', () => ({}));

const { readCookieMock, fromMock, lookupSessionRowIdMock, getConsentHistoryMock, purgeConsentAuditMock } =
  vi.hoisted(() => ({
    readCookieMock: vi.fn(async (_name: string): Promise<string | undefined> => 'sess-token-abc'),
    fromMock: vi.fn(),
    lookupSessionRowIdMock: vi.fn(async (): Promise<string | null> => 'sess-row-1'),
    getConsentHistoryMock: vi.fn(() => []),
    purgeConsentAuditMock: vi.fn(() => ({ consent_events: 0 })),
  }));

vi.mock('@/lib/cookies', () => ({
  COOKIE_NAMES: { session: 'voter_session', consent: 'voter_consent', visitor: 'voter_visitor_id', utm: 'voter_utm', zip: 'voter_zip' },
  readCookie: readCookieMock,
}));
vi.mock('@/lib/data/adapter-service', () => ({ getServiceClient: () => ({ from: fromMock }) }));
vi.mock('@/lib/app/session', () => ({
  lookupSessionRowId: lookupSessionRowIdMock,
  resolveSessionRowId: vi.fn(async () => 'sess-row-1'),
}));
vi.mock('@/lib/visit-tracker', () => ({
  getConsentHistory: getConsentHistoryMock,
  purgeConsentAudit: purgeConsentAuditMock,
}));

function selectTable(rows: unknown[], error: unknown = null) {
  const eq = vi.fn().mockResolvedValue({ data: rows, error });
  const select = vi.fn(() => ({ eq }));
  return { select, __eq: eq };
}

function deleteTable(count: number, error: unknown = null) {
  const eq = vi.fn().mockResolvedValue({ error, count });
  const del = vi.fn(() => ({ eq }));
  return { delete: del, __eq: eq };
}

function getRequest(): NextRequest {
  return new NextRequest('http://localhost/api/data-rights', { method: 'GET' });
}

function deleteRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/data-rights', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/data-rights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readCookieMock.mockResolvedValue('sess-token-abc');
    lookupSessionRowIdMock.mockResolvedValue('sess-row-1');
    getConsentHistoryMock.mockReturnValue([]);
  });

  it('returns 401 no_session when the session cookie is missing', async () => {
    readCookieMock.mockResolvedValue(undefined);
    const { GET } = await import('@/app/api/data-rights/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns an honest empty export when no sessions row exists yet', async () => {
    lookupSessionRowIdMock.mockResolvedValue(null);
    const { GET } = await import('@/app/api/data-rights/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.interactions).toEqual([]);
    expect(json.quick_poll_responses).toEqual([]);
    expect(json.visits).toEqual([]);
    expect(json.matches).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('reads all four tables scoped to the resolved session row', async () => {
    const interactions = selectTable([{ id: 'i1', candidate_id: 'c1', race_id: 'r1', action: 'viewed', view_order: 1, dwell_ms: 100, created_at: 't' }]);
    const poll = selectTable([{ id: 'p1', race_id: 'r1', issue_id: 'iss1', weight: 5, created_at: 't' }]);
    const visits = selectTable([{ id: 'v1', visit_started_at: 't', visit_ended_at: null, pages_viewed: 2, ip_country: 'US', ip_region: 'FL' }]);
    const matches = selectTable([{ id: 'm1', race_id: 'r1', model: 'heuristic-v1', input_tokens: null, output_tokens: null, created_at: 't' }]);
    fromMock.mockImplementation((table: string) => {
      if (table === 'candidate_interactions') return interactions;
      if (table === 'quick_poll_responses') return poll;
      if (table === 'session_visits') return visits;
      if (table === 'llm_matches') return matches;
      throw new Error(`unexpected table ${table}`);
    });

    const { GET } = await import('@/app/api/data-rights/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.interactions).toHaveLength(1);
    expect(json.quick_poll_responses).toHaveLength(1);
    expect(json.visits).toHaveLength(1);
    expect(json.matches).toHaveLength(1);

    expect(interactions.__eq).toHaveBeenCalledWith('session_id', 'sess-row-1');
    expect(poll.__eq).toHaveBeenCalledWith('session_id', 'sess-row-1');
    expect(visits.__eq).toHaveBeenCalledWith('session_id', 'sess-row-1');
    expect(matches.__eq).toHaveBeenCalledWith('session_id', 'sess-row-1');

    // The raw session token never leaks into the response.
    expect(JSON.stringify(json)).not.toContain('sess-token-abc');
  });

  it('surfaces a read failure as a real error status, never a fake empty success', async () => {
    const interactions = selectTable([], { message: 'connection reset' });
    fromMock.mockImplementation((table: string) => {
      if (table === 'candidate_interactions') return interactions;
      return selectTable([]);
    });
    const { GET } = await import('@/app/api/data-rights/route');
    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });
});

describe('DELETE /api/data-rights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readCookieMock.mockResolvedValue('sess-token-abc');
    lookupSessionRowIdMock.mockResolvedValue('sess-row-1');
    purgeConsentAuditMock.mockReturnValue({ consent_events: 2 });
  });

  it('requires {"confirm": true} — 400 otherwise', async () => {
    const { DELETE } = await import('@/app/api/data-rights/route');
    const res = await DELETE(deleteRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 401 no_session when the session cookie is missing', async () => {
    readCookieMock.mockResolvedValue(undefined);
    const { DELETE } = await import('@/app/api/data-rights/route');
    const res = await DELETE(deleteRequest({ confirm: true }));
    expect(res.status).toBe(401);
  });

  it('deletes from all four tables plus the sessions identity row, and clears cookies', async () => {
    const interactions = deleteTable(3);
    const poll = deleteTable(2);
    const visits = deleteTable(1);
    const matches = deleteTable(1);
    const sessions = deleteTable(1);
    fromMock.mockImplementation((table: string) => {
      if (table === 'candidate_interactions') return interactions;
      if (table === 'quick_poll_responses') return poll;
      if (table === 'session_visits') return visits;
      if (table === 'llm_matches') return matches;
      if (table === 'sessions') return sessions;
      throw new Error(`unexpected table ${table}`);
    });

    const { DELETE } = await import('@/app/api/data-rights/route');
    const res = await DELETE(deleteRequest({ confirm: true }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.purged).toEqual({
      interactions: 3,
      quickPollResponses: 2,
      visits: 1,
      matches: 1,
      sessions: 1,
      consent_events: 2,
    });

    expect(interactions.__eq).toHaveBeenCalledWith('session_id', 'sess-row-1');
    expect(matches.__eq).toHaveBeenCalledWith('session_id', 'sess-row-1');
    // The sessions row is the identity row — deleted by its own id, not
    // by a session_id foreign key (it has none of its own).
    expect(sessions.__eq).toHaveBeenCalledWith('id', 'sess-row-1');

    expect(res.cookies.get('voter_session')?.value).toBe('');
  });

  it('surfaces a delete failure as 500, never a fake success', async () => {
    const interactions = deleteTable(0, { message: 'connection reset' });
    fromMock.mockImplementation((table: string) => {
      if (table === 'candidate_interactions') return interactions;
      return deleteTable(0);
    });

    const { DELETE } = await import('@/app/api/data-rights/route');
    const res = await DELETE(deleteRequest({ confirm: true }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it('surfaces a sessions-identity-delete failure as 500, even when all four child deletes succeed', async () => {
    const interactions = deleteTable(3);
    const poll = deleteTable(2);
    const visits = deleteTable(1);
    const matches = deleteTable(1);
    const sessions = deleteTable(0, { message: 'connection reset' });
    fromMock.mockImplementation((table: string) => {
      if (table === 'candidate_interactions') return interactions;
      if (table === 'quick_poll_responses') return poll;
      if (table === 'session_visits') return visits;
      if (table === 'llm_matches') return matches;
      if (table === 'sessions') return sessions;
      throw new Error(`unexpected table ${table}`);
    });

    const { DELETE } = await import('@/app/api/data-rights/route');
    const res = await DELETE(deleteRequest({ confirm: true }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });
});
