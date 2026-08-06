// Contract tests for POST /api/interaction (T15, SPEC-2026-08-06.md C2).
// Mocks cookies, rate-limit, and the anon Supabase adapter so this
// exercises the route's own branching (rate limit, session gate,
// consent gate, error surfacing) plus the insert payload shape built by
// src/lib/app/interactions.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// The real src/lib/app/* modules under test import 'server-only', which
// Next.js no-ops via webpack's `react-server` export condition at build
// time. Vitest doesn't apply that condition, so the package's plain
// index.js (which unconditionally throws) would load instead — stub it
// to a no-op so the real application modules can run in this test.
vi.mock('server-only', () => ({}));

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  exceeded?: 'session' | 'ip';
}

const { readCookieMock, checkRateLimitsMock, fromMock } = vi.hoisted(() => ({
  readCookieMock: vi.fn(async (_name: string): Promise<string | undefined> => undefined),
  checkRateLimitsMock: vi.fn(
    async (): Promise<RateLimitResult> => ({ allowed: true, remaining: 10, retryAfterSeconds: 0 }),
  ),
  fromMock: vi.fn(),
}));

vi.mock('@/lib/cookies', () => ({
  COOKIE_NAMES: { session: 'voter_session', consent: 'voter_consent' },
  readCookie: readCookieMock,
}));
vi.mock('@/lib/geo', () => ({
  clientIpFromHeaders: () => '1.2.3.4',
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimits: checkRateLimitsMock,
  INTERACTION_LIMITS: {
    session: { capacity: 300, windowMs: 3_600_000 },
    ip: { capacity: 1500, windowMs: 3_600_000 },
  },
}));
vi.mock('@/lib/data/adapter-anon', () => ({
  getAnonClient: () => ({ from: fromMock }),
}));

function sessionsTable(opts: { lookupId?: string | null; insertId?: string; insertError?: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: opts.lookupId ? { id: opts.lookupId } : null,
    error: null,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const single = vi.fn().mockResolvedValue({
    data: opts.insertId ? { id: opts.insertId } : null,
    error: opts.insertError ?? null,
  });
  const insertSelect = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select: insertSelect }));
  return { select, insert, __eq: eq, __insert: insert };
}

function interactionsTable(result: { error: unknown }) {
  const insert = vi.fn().mockResolvedValue(result);
  return { insert };
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/interaction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  candidate_id: 'cand-1',
  race_id: 'race-fl-01-r-2026',
  action: 'viewed' as const,
  view_order: 1,
  dwell_ms: 1200,
};

describe('POST /api/interaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readCookieMock.mockImplementation(async (name: string) => {
      if (name === 'voter_session') return 'sess-token-abc';
      return undefined;
    });
    checkRateLimitsMock.mockResolvedValue({ allowed: true, remaining: 10, retryAfterSeconds: 0 });
  });

  it('returns 429 when rate-limited, without touching the adapter', async () => {
    checkRateLimitsMock.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 30,
      exceeded: 'session',
    });
    const { POST } = await import('@/app/api/interaction/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload with 400', async () => {
    const { POST } = await import('@/app/api/interaction/route');
    const res = await POST(postRequest({ candidate_id: 'x' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe('invalid_payload');
  });

  it('returns 401 no_session when the session cookie is missing', async () => {
    readCookieMock.mockResolvedValue(undefined);
    const { POST } = await import('@/app/api/interaction/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('no_session');
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('drops the row silently (200) on analytics opt-out, without writing', async () => {
    readCookieMock.mockImplementation(async (name: string) => {
      if (name === 'voter_session') return 'sess-token-abc';
      if (name === 'voter_consent')
        return JSON.stringify({ analytics: false, data_sale: false, marketing: false, version: 1 });
      return undefined;
    });
    const { POST } = await import('@/app/api/interaction/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, dropped: 'consent' });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('resolves an existing session row and inserts the correct payload shape', async () => {
    const sessions = sessionsTable({ lookupId: 'sess-row-1' });
    const interactions = interactionsTable({ error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === 'sessions') return sessions;
      if (table === 'candidate_interactions') return interactions;
      throw new Error(`unexpected table ${table}`);
    });

    const { POST } = await import('@/app/api/interaction/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });

    // Session row was looked up but not (re)created.
    expect(sessions.__insert).not.toHaveBeenCalled();

    expect(interactions.insert).toHaveBeenCalledWith({
      session_id: 'sess-row-1',
      candidate_id: 'cand-1',
      race_id: 'race-fl-01-r-2026',
      action: 'viewed',
      view_order: 1,
      dwell_ms: 1200,
    });
  });

  it('creates a session row on first write for a brand-new token', async () => {
    const sessions = sessionsTable({ lookupId: null, insertId: 'sess-row-new' });
    const interactions = interactionsTable({ error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === 'sessions') return sessions;
      if (table === 'candidate_interactions') return interactions;
      throw new Error(`unexpected table ${table}`);
    });

    const { POST } = await import('@/app/api/interaction/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(200);
    expect(sessions.__insert).toHaveBeenCalledWith({ session_token: 'sess-token-abc' });
    expect(interactions.insert).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: 'sess-row-new' }),
    );
  });

  it('maps a foreign-key violation to 400 invalid_reference', async () => {
    const sessions = sessionsTable({ lookupId: 'sess-row-1' });
    const interactions = interactionsTable({
      error: { code: '23503', message: 'candidate_id not found' },
    });
    fromMock.mockImplementation((table: string) => {
      if (table === 'sessions') return sessions;
      if (table === 'candidate_interactions') return interactions;
      throw new Error(`unexpected table ${table}`);
    });

    const { POST } = await import('@/app/api/interaction/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ ok: false, error: 'invalid_reference' });
  });

  it('surfaces an unexpected write failure as 500, never a fake success', async () => {
    const sessions = sessionsTable({ lookupId: 'sess-row-1' });
    const interactions = interactionsTable({
      error: { message: 'connection reset' },
    });
    fromMock.mockImplementation((table: string) => {
      if (table === 'sessions') return sessions;
      if (table === 'candidate_interactions') return interactions;
      throw new Error(`unexpected table ${table}`);
    });

    const { POST } = await import('@/app/api/interaction/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ ok: false, error: 'write_failed' });
  });
});
