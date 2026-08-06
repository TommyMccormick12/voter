// Contract tests for POST /api/quick-poll (T15, SPEC-2026-08-06.md C2).
// Mocks cookies, rate-limit, and the anon Supabase adapter. Exercises
// rate limiting, session gate, consent gate, issue_slug -> issue_id
// resolution (src/lib/app/quick-poll.ts), and error surfacing.

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
  POLL_LIMITS: {
    session: { capacity: 30, windowMs: 3_600_000 },
    ip: { capacity: 100, windowMs: 3_600_000 },
  },
}));
vi.mock('@/lib/data/adapter-anon', () => ({
  getAnonClient: () => ({ from: fromMock }),
}));

function sessionsTable(sessionRowId: string) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: { id: sessionRowId }, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return { select };
}

function issuesTable(rows: Array<{ id: string; slug: string }>) {
  const inFn = vi.fn().mockResolvedValue({ data: rows, error: null });
  const select = vi.fn(() => ({ in: inFn }));
  return { select, __in: inFn };
}

function pollTable(result: { error: unknown }) {
  const insert = vi.fn().mockResolvedValue(result);
  return { insert };
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/quick-poll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  race_id: 'race-fl-01-r-2026',
  responses: [
    { issue_slug: 'economy', weight: 5 },
    { issue_slug: 'healthcare', weight: 3 },
  ],
};

describe('POST /api/quick-poll', () => {
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
      retryAfterSeconds: 15,
      exceeded: 'ip',
    });
    const { POST } = await import('@/app/api/quick-poll/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(429);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload with 400', async () => {
    const { POST } = await import('@/app/api/quick-poll/route');
    const res = await POST(postRequest({ race_id: 'x', responses: [] }));
    expect(res.status).toBe(400);
  });

  it('returns 401 no_session when the session cookie is missing', async () => {
    readCookieMock.mockResolvedValue(undefined);
    const { POST } = await import('@/app/api/quick-poll/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(401);
  });

  it('drops silently (200) on analytics opt-out, without writing', async () => {
    readCookieMock.mockImplementation(async (name: string) => {
      if (name === 'voter_session') return 'sess-token-abc';
      if (name === 'voter_consent')
        return JSON.stringify({ analytics: false, data_sale: false, marketing: false, version: 1 });
      return undefined;
    });
    const { POST } = await import('@/app/api/quick-poll/route');
    const res = await POST(postRequest(validBody));
    const json = await res.json();
    expect(json).toEqual({ ok: true, dropped: 'consent' });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('resolves issue_slug -> issue_id and inserts one row per response', async () => {
    const sessions = sessionsTable('sess-row-1');
    const issues = issuesTable([
      { id: 'issue-econ', slug: 'economy' },
      { id: 'issue-health', slug: 'healthcare' },
    ]);
    const poll = pollTable({ error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === 'sessions') return sessions;
      if (table === 'issues') return issues;
      if (table === 'quick_poll_responses') return poll;
      throw new Error(`unexpected table ${table}`);
    });

    const { POST } = await import('@/app/api/quick-poll/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, recorded: 2 });

    expect(poll.insert).toHaveBeenCalledWith([
      { session_id: 'sess-row-1', race_id: 'race-fl-01-r-2026', issue_id: 'issue-econ', weight: 5 },
      { session_id: 'sess-row-1', race_id: 'race-fl-01-r-2026', issue_id: 'issue-health', weight: 3 },
    ]);
  });

  it('rejects an unknown issue_slug with 400 before writing any row', async () => {
    const sessions = sessionsTable('sess-row-1');
    const issues = issuesTable([{ id: 'issue-econ', slug: 'economy' }]); // 'healthcare' missing
    const poll = pollTable({ error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === 'sessions') return sessions;
      if (table === 'issues') return issues;
      if (table === 'quick_poll_responses') return poll;
      throw new Error(`unexpected table ${table}`);
    });

    const { POST } = await import('@/app/api/quick-poll/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('unknown_issue');
    expect(json.unknown_issues).toEqual(['healthcare']);
    expect(poll.insert).not.toHaveBeenCalled();
  });

  it('surfaces an unexpected write failure as 500, never a fake success', async () => {
    const sessions = sessionsTable('sess-row-1');
    const issues = issuesTable([
      { id: 'issue-econ', slug: 'economy' },
      { id: 'issue-health', slug: 'healthcare' },
    ]);
    const poll = pollTable({ error: { message: 'connection reset' } });
    fromMock.mockImplementation((table: string) => {
      if (table === 'sessions') return sessions;
      if (table === 'issues') return issues;
      if (table === 'quick_poll_responses') return poll;
      throw new Error(`unexpected table ${table}`);
    });

    const { POST } = await import('@/app/api/quick-poll/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe('write_failed');
  });
});
