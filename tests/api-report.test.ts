// Contract tests for POST /api/report (T23, SPEC-2026-08-06.md E3).
//
// Mocks cookies, rate-limit, geo, the service-role adapter, and
// src/lib/app/session (session-row resolution — already covered by
// tests/api-interaction.test.ts). Follows the same mocking pattern as
// tests/api-match.test.ts / tests/api-interaction.test.ts.
//
// Regression lock: candidate_reports.session_id must be the RESOLVED
// sessions.id uuid (via lookupSessionRowId), never the raw voter_session
// cookie token. A prior bug wrote the raw token into a uuid FK column.

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

const {
  readCookieMock,
  checkRateLimitsMock,
  fromMock,
  getServiceClientMock,
  lookupSessionRowIdMock,
} = vi.hoisted(() => ({
  readCookieMock: vi.fn(async (_name: string): Promise<string | undefined> => 'sess-token-abc'),
  checkRateLimitsMock: vi.fn(
    async (): Promise<RateLimitResult> => ({ allowed: true, remaining: 10, retryAfterSeconds: 0 }),
  ),
  fromMock: vi.fn(),
  getServiceClientMock: vi.fn(() => ({ from: fromMock })),
  lookupSessionRowIdMock: vi.fn(async () => 'sess-row-1'),
}));

vi.mock('@/lib/cookies', () => ({
  COOKIE_NAMES: { session: 'voter_session' },
  readCookie: readCookieMock,
}));
vi.mock('@/lib/geo', () => ({
  clientIpFromHeaders: () => '1.2.3.4',
  hashIp: (ip: string | null) => (ip ? `hashed:${ip}` : null),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimits: checkRateLimitsMock,
  REPORT_LIMITS: {
    session: { capacity: 10, windowMs: 3_600_000 },
    ip: { capacity: 30, windowMs: 3_600_000 },
  },
}));
vi.mock('@/lib/data/adapter-service', () => ({
  getServiceClient: getServiceClientMock,
}));
vi.mock('@/lib/app/session', () => ({
  lookupSessionRowId: lookupSessionRowIdMock,
}));

function reportsTable(opts: { insertId?: string; insertError?: unknown }) {
  const single = vi.fn().mockResolvedValue({
    data: opts.insertId ? { id: opts.insertId } : null,
    error: opts.insertError ?? null,
  });
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  return { insert, select };
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  candidate_id: 'cand-1',
  category: 'factual_error' as const,
  description: 'This candidate never voted for that bill as the page claims.',
};

describe('POST /api/report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readCookieMock.mockResolvedValue('sess-token-abc');
    checkRateLimitsMock.mockResolvedValue({ allowed: true, remaining: 10, retryAfterSeconds: 0 });
    getServiceClientMock.mockImplementation(() => ({ from: fromMock }));
    lookupSessionRowIdMock.mockResolvedValue('sess-row-1');
  });

  it('returns 429 when rate-limited, without touching the service client', async () => {
    checkRateLimitsMock.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 45,
      exceeded: 'ip',
    });
    const { POST } = await import('@/app/api/report/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('45');
    const json = await res.json();
    expect(json).toEqual({
      ok: false,
      error: 'rate_limited',
      scope: 'ip',
      retry_after_seconds: 45,
    });
    expect(getServiceClientMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload with 400 (description too short)', async () => {
    const { POST } = await import('@/app/api/report/route');
    const res = await POST(
      postRequest({ candidate_id: 'cand-1', category: 'factual_error', description: 'too short' }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe('invalid_payload');
  });

  it('rejects an invalid payload with 400 (unknown category)', async () => {
    const { POST } = await import('@/app/api/report/route');
    const res = await POST(
      postRequest({ ...validBody, category: 'not_a_real_category' }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_payload');
  });

  it('rejects unparseable JSON with 400 invalid_json', async () => {
    const { POST } = await import('@/app/api/report/route');
    const badReq = new NextRequest('http://localhost/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });
    const res = await POST(badReq);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_json');
  });

  it('inserts with the RESOLVED sessions.id (not the raw cookie token) — regression lock', async () => {
    const table = reportsTable({ insertId: 'report-1' });
    fromMock.mockReturnValue(table);

    const { POST } = await import('@/app/api/report/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, report_id: 'report-1' });

    expect(lookupSessionRowIdMock).toHaveBeenCalledWith('sess-token-abc');
    expect(table.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate_id: 'cand-1',
        session_id: 'sess-row-1', // resolved uuid, never 'sess-token-abc'
        category: 'factual_error',
      }),
    );
    const insertedPayload = table.insert.mock.calls[0][0];
    expect(insertedPayload.session_id).not.toBe('sess-token-abc');
  });

  it('inserts with a null session_id when there is no session cookie (anonymous report)', async () => {
    readCookieMock.mockResolvedValue(undefined);
    const table = reportsTable({ insertId: 'report-2' });
    fromMock.mockReturnValue(table);

    const { POST } = await import('@/app/api/report/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(200);
    expect(lookupSessionRowIdMock).not.toHaveBeenCalled();
    expect(table.insert).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: null }),
    );
  });

  it('builds the insert payload with the full expected shape', async () => {
    const table = reportsTable({ insertId: 'report-3' });
    fromMock.mockReturnValue(table);

    const { POST } = await import('@/app/api/report/route');
    const res = await POST(
      postRequest({
        ...validBody,
        stance_id: 'jane-doe-economy',
        cited_bill_id: 'hr7567-119',
        reporter_email: 'voter@example.com',
      }),
    );
    expect(res.status).toBe(200);
    expect(table.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate_id: 'cand-1',
        session_id: 'sess-row-1',
        stance_id: 'jane-doe-economy',
        cited_bill_id: 'hr7567-119',
        category: 'factual_error',
        description: validBody.description,
        reporter_email: 'voter@example.com',
        ip_hash: 'hashed:1.2.3.4',
      }),
    );
    const insertedPayload = table.insert.mock.calls[0][0];
    expect(typeof insertedPayload.description_hash).toBe('string');
    expect(insertedPayload.description_hash).toHaveLength(64); // sha256 hex
  });

  it('dedupe: a 23505 unique-violation returns 200 {ok, deduplicated} silently', async () => {
    const table = reportsTable({ insertError: { code: '23505', message: 'duplicate key value' } });
    fromMock.mockReturnValue(table);

    const { POST } = await import('@/app/api/report/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, deduplicated: true });
  });

  it('returns 500 server_misconfigured when the service client cannot be constructed', async () => {
    getServiceClientMock.mockImplementation(() => {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
    });

    const { POST } = await import('@/app/api/report/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ ok: false, error: 'server_misconfigured' });
    // Never attempted a session lookup or insert once the client is unusable.
    expect(lookupSessionRowIdMock).not.toHaveBeenCalled();
  });

  it('maps FK violations (23503) to 400 unknown_reference without leaking DB internals', async () => {
    const table = reportsTable({
      insertError: {
        code: '23503',
        message: 'insert or update on table violates foreign key constraint',
      },
    });
    fromMock.mockReturnValue(table);

    const { POST } = await import('@/app/api/report/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ ok: false, error: 'unknown_reference' });
  });

  it('surfaces non-client insert failures as 500 write_failed, never a fake success or a 400', async () => {
    const table = reportsTable({
      insertError: { code: '57P01', message: 'terminating connection due to administrator command' },
    });
    fromMock.mockReturnValue(table);

    const { POST } = await import('@/app/api/report/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ ok: false, error: 'write_failed' });
  });
});
