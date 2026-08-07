// Contract tests for POST /api/visit (T15, SPEC-2026-08-06.md C2).
// Mocks cookies, rate-limit, geo, and the anon + service-role Supabase
// adapters. Exercises rate limiting, session gate, consent gate, the
// open/close visit logic in src/lib/app/visits.ts, and error surfacing.
//
// session_visits reads/inserts go through the anon adapter (public
// SELECT/INSERT policies, migration 005). session_visits UPDATEs go
// through the service-role adapter — there is no UPDATE policy on that
// table, so an anon update would silently match zero rows (see
// src/lib/app/visits.ts header comment for the full reasoning). Tests
// below therefore mock the two adapters separately and assert updates
// land on the service-role mock, not the anon one.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// See tests/api-interaction.test.ts for why 'server-only' needs stubbing here.
vi.mock('server-only', () => ({}));

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  exceeded?: 'session' | 'ip';
}

const { readCookieMock, checkRateLimitsMock, fromMock, fromServiceMock } = vi.hoisted(() => ({
  readCookieMock: vi.fn(async (_name: string): Promise<string | undefined> => undefined),
  checkRateLimitsMock: vi.fn(
    async (): Promise<RateLimitResult> => ({ allowed: true, remaining: 10, retryAfterSeconds: 0 }),
  ),
  fromMock: vi.fn(),
  fromServiceMock: vi.fn(),
}));

const CONSENT_OPT_IN = JSON.stringify({ analytics: true, data_sale: false, marketing: false, version: 1 });

vi.mock('@/lib/cookies', () => ({
  COOKIE_NAMES: { session: 'voter_session', consent: 'voter_consent' },
  readCookie: readCookieMock,
}));
vi.mock('@/lib/geo', () => ({
  clientIpFromHeaders: () => '1.2.3.4',
  geoFromHeaders: () => ({ country: 'US', region: 'FL' }),
  hashUserAgent: () => 'ua-hash',
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimits: checkRateLimitsMock,
  VISIT_LIMITS: {
    session: { capacity: 30, windowMs: 3_600_000 },
    ip: { capacity: 100, windowMs: 3_600_000 },
  },
}));
vi.mock('@/lib/data/adapter-anon', () => ({
  getAnonClient: () => ({ from: fromMock }),
}));
vi.mock('@/lib/data/adapter-service', () => ({
  getServiceClient: () => ({ from: fromServiceMock }),
}));

function sessionsTable(sessionRowId: string) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: { id: sessionRowId }, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return { select };
}

/**
 * session_visits mocks, split by client: `anon` covers select (find open
 * visit) + insert; `service` covers update (the only client with an
 * UPDATE policy-shaped path in production).
 */
function visitsTable(opts: {
  open: { id: string; visit_started_at: string; pages_viewed: number } | null;
  updateError?: unknown;
  /** Simulate a 0-row update result: no error, but no id came back either. */
  updateMatchedNoRows?: boolean;
  insertError?: unknown;
}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: opts.open, error: null });
  const limit = vi.fn(() => ({ maybeSingle }));
  const order = vi.fn(() => ({ limit }));
  const isFn = vi.fn(() => ({ order }));
  const findEq = vi.fn(() => ({ is: isFn }));
  const select = vi.fn(() => ({ eq: findEq }));
  const insert = vi.fn().mockResolvedValue({ error: opts.insertError ?? null });
  const anon = { select, insert };

  const updateSelect = vi.fn().mockResolvedValue({
    data: opts.updateError ? null : opts.updateMatchedNoRows ? [] : [{ id: opts.open?.id ?? 'row-id' }],
    error: opts.updateError ?? null,
  });
  const updateEq = vi.fn(() => ({ select: updateSelect }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const service = { update, __updateEq: updateEq, __updateSelect: updateSelect };

  return { anon, service };
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/visit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/visit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readCookieMock.mockImplementation(async (name: string) => {
      if (name === 'voter_session') return 'sess-token-abc';
      if (name === 'voter_consent') return CONSENT_OPT_IN;
      return undefined;
    });
    checkRateLimitsMock.mockResolvedValue({ allowed: true, remaining: 10, retryAfterSeconds: 0 });
  });

  it('returns 429 when rate-limited, without touching the adapter', async () => {
    checkRateLimitsMock.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 5,
      exceeded: 'session',
    });
    const { POST } = await import('@/app/api/visit/route');
    const res = await POST(postRequest({ type: 'start', path: '/scorecards/race-1' }));
    expect(res.status).toBe(429);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('returns 401 no_session when the session cookie is missing', async () => {
    readCookieMock.mockResolvedValue(undefined);
    const { POST } = await import('@/app/api/visit/route');
    const res = await POST(postRequest({ type: 'start', path: '/scorecards/race-1' }));
    expect(res.status).toBe(401);
  });

  it('drops silently (200) on analytics opt-out, without writing', async () => {
    readCookieMock.mockImplementation(async (name: string) => {
      if (name === 'voter_session') return 'sess-token-abc';
      if (name === 'voter_consent')
        return JSON.stringify({ analytics: false, data_sale: false, marketing: false, version: 1 });
      return undefined;
    });
    const { POST } = await import('@/app/api/visit/route');
    const res = await POST(postRequest({ type: 'start', path: '/scorecards/race-1' }));
    const json = await res.json();
    expect(json).toEqual({ ok: true, dropped: 'consent' });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('drops silently (200) when no consent cookie has been set yet, without writing', async () => {
    // Pre-consent visitors (no voter_consent cookie at all, not just an
    // opt-out) must not be tracked either — the route's `!consent?.analytics`
    // gate treats "absent" the same as "explicit false".
    readCookieMock.mockImplementation(async (name: string) => {
      if (name === 'voter_session') return 'sess-token-abc';
      return undefined;
    });
    const { POST } = await import('@/app/api/visit/route');
    const res = await POST(postRequest({ type: 'start', path: '/scorecards/race-1' }));
    const json = await res.json();
    expect(json).toEqual({ ok: true, dropped: 'consent' });
    expect(fromMock).not.toHaveBeenCalled();
    expect(fromServiceMock).not.toHaveBeenCalled();
  });

  it('opens a new visit when none is active', async () => {
    const sessions = sessionsTable('sess-row-1');
    const visits = visitsTable({ open: null });
    fromMock.mockImplementation((table: string) => {
      if (table === 'sessions') return sessions;
      if (table === 'session_visits') return visits.anon;
      throw new Error(`unexpected table ${table}`);
    });
    fromServiceMock.mockImplementation((table: string) => {
      if (table === 'session_visits') return visits.service;
      throw new Error(`unexpected table ${table}`);
    });

    const { POST } = await import('@/app/api/visit/route');
    const res = await POST(postRequest({ type: 'start', path: '/scorecards/race-1' }));
    expect(res.status).toBe(200);
    expect(visits.anon.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 'sess-row-1',
        pages_viewed: 1,
        ip_country: 'US',
        ip_region: 'FL',
        user_agent_hash: 'ua-hash',
      }),
    );
    expect(visits.service.update).not.toHaveBeenCalled();
  });

  it('increments pages_viewed on a fresh open visit instead of opening a new one, via the service client', async () => {
    const sessions = sessionsTable('sess-row-1');
    const visits = visitsTable({
      open: { id: 'visit-1', visit_started_at: new Date().toISOString(), pages_viewed: 2 },
    });
    fromMock.mockImplementation((table: string) => {
      if (table === 'sessions') return sessions;
      if (table === 'session_visits') return visits.anon;
      throw new Error(`unexpected table ${table}`);
    });
    fromServiceMock.mockImplementation((table: string) => {
      if (table === 'session_visits') return visits.service;
      throw new Error(`unexpected table ${table}`);
    });

    const { POST } = await import('@/app/api/visit/route');
    const res = await POST(postRequest({ type: 'start', path: '/scorecards/race-2' }));
    expect(res.status).toBe(200);
    expect(visits.service.update).toHaveBeenCalledWith({ pages_viewed: 3 });
    expect(visits.service.__updateEq).toHaveBeenCalledWith('id', 'visit-1');
    expect(visits.anon.insert).not.toHaveBeenCalled();
    // The update must not run on the anon client — no UPDATE policy exists there.
    expect(visits.anon).not.toHaveProperty('update');
  });

  it('closes the current open visit on {type:"end"}, via the service client', async () => {
    const sessions = sessionsTable('sess-row-1');
    const visits = visitsTable({
      open: { id: 'visit-1', visit_started_at: new Date().toISOString(), pages_viewed: 1 },
    });
    fromMock.mockImplementation((table: string) => {
      if (table === 'sessions') return sessions;
      if (table === 'session_visits') return visits.anon;
      throw new Error(`unexpected table ${table}`);
    });
    fromServiceMock.mockImplementation((table: string) => {
      if (table === 'session_visits') return visits.service;
      throw new Error(`unexpected table ${table}`);
    });

    const { POST } = await import('@/app/api/visit/route');
    const res = await POST(postRequest({ type: 'end' }));
    expect(res.status).toBe(200);
    expect(visits.service.update).toHaveBeenCalledWith(
      expect.objectContaining({ visit_ended_at: expect.any(String) }),
    );
    expect(visits.service.__updateEq).toHaveBeenCalledWith('id', 'visit-1');
  });

  it('surfaces an unexpected write failure as 500, never a fake success', async () => {
    const sessions = sessionsTable('sess-row-1');
    const visits = visitsTable({ open: null, insertError: { message: 'connection reset' } });
    fromMock.mockImplementation((table: string) => {
      if (table === 'sessions') return sessions;
      if (table === 'session_visits') return visits.anon;
      throw new Error(`unexpected table ${table}`);
    });
    fromServiceMock.mockImplementation((table: string) => {
      if (table === 'session_visits') return visits.service;
      throw new Error(`unexpected table ${table}`);
    });

    const { POST } = await import('@/app/api/visit/route');
    const res = await POST(postRequest({ type: 'start', path: '/scorecards/race-1' }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ ok: false, error: 'write_failed' });
  });

  it('treats a 0-row service-client update as a real failure, never a fake success', async () => {
    // No RLS UPDATE policy exists on session_visits (migration 005). If
    // an update ever matches zero rows — e.g. the row vanished, or a
    // future regression points the update back at the anon client —
    // this must surface as write_failed, not a silent 200.
    const sessions = sessionsTable('sess-row-1');
    const visits = visitsTable({
      open: { id: 'visit-1', visit_started_at: new Date().toISOString(), pages_viewed: 2 },
      updateMatchedNoRows: true,
    });
    fromMock.mockImplementation((table: string) => {
      if (table === 'sessions') return sessions;
      if (table === 'session_visits') return visits.anon;
      throw new Error(`unexpected table ${table}`);
    });
    fromServiceMock.mockImplementation((table: string) => {
      if (table === 'session_visits') return visits.service;
      throw new Error(`unexpected table ${table}`);
    });

    const { POST } = await import('@/app/api/visit/route');
    const res = await POST(postRequest({ type: 'start', path: '/scorecards/race-2' }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ ok: false, error: 'write_failed' });
  });
});
