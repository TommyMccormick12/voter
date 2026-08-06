// Contract tests for POST /api/match (T15/T17, SPEC-2026-08-06.md C2/C4).
//
// Mocks cookies, rate-limit, data/races + data/candidates (external
// dependencies this route doesn't own), the service-role adapter, and
// src/lib/app/session (session-row resolution — already covered by
// tests/api-interaction.test.ts). matchCandidates is mocked but
// hashFreeText / HAIKU_MODEL_LABEL / MOCK_MODEL_LABEL stay real so the
// upsert payload assertions exercise the actual model-labeling logic in
// src/lib/app/match.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { HAIKU_MODEL_LABEL, MOCK_MODEL_LABEL, hashFreeText } from '@/lib/llm/match';

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
  getRaceMock,
  getCandidatesForRaceMock,
  matchCandidatesMock,
  fromMock,
  resolveSessionRowIdMock,
} = vi.hoisted(() => ({
  readCookieMock: vi.fn(async (_name: string): Promise<string | undefined> => 'sess-token-abc'),
  checkRateLimitsMock: vi.fn(
    async (): Promise<RateLimitResult> => ({ allowed: true, remaining: 10, retryAfterSeconds: 0 }),
  ),
  getRaceMock: vi.fn(),
  getCandidatesForRaceMock: vi.fn(),
  matchCandidatesMock: vi.fn(),
  fromMock: vi.fn(),
  resolveSessionRowIdMock: vi.fn(async () => 'sess-row-1'),
}));

vi.mock('@/lib/cookies', () => ({
  COOKIE_NAMES: { session: 'voter_session' },
  readCookie: readCookieMock,
}));
vi.mock('@/lib/geo', () => ({ clientIpFromHeaders: () => '1.2.3.4' }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimits: checkRateLimitsMock,
  MATCH_LIMITS: {
    session: { capacity: 10, windowMs: 3_600_000 },
    ip: { capacity: 30, windowMs: 3_600_000 },
  },
}));
vi.mock('@/lib/data/races', () => ({ getRace: getRaceMock }));
vi.mock('@/lib/data/candidates', () => ({ getCandidatesForRace: getCandidatesForRaceMock }));
vi.mock('@/lib/data/adapter-service', () => ({ getServiceClient: () => ({ from: fromMock }) }));
vi.mock('@/lib/app/session', () => ({
  resolveSessionRowId: resolveSessionRowIdMock,
  lookupSessionRowId: vi.fn(async () => 'sess-row-1'),
}));
vi.mock('@/lib/llm/match', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/match')>();
  return { ...actual, matchCandidates: matchCandidatesMock };
});

function llmMatchesTable(opts: {
  existing?: { id: string; model: string; input_tokens: number | null; output_tokens: number | null; ranked_candidates: unknown } | null;
  upsertId?: string;
  upsertError?: unknown;
}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: opts.existing ?? null, error: null });
  const eq2 = vi.fn(() => ({ maybeSingle }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));

  const single = vi.fn().mockResolvedValue({
    data: opts.upsertId ? { id: opts.upsertId } : null,
    error: opts.upsertError ?? null,
  });
  const upsertSelect = vi.fn(() => ({ single }));
  const upsert = vi.fn(() => ({ select: upsertSelect }));

  return { select, upsert, __upsert: upsert };
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const race = {
  id: 'race-fl-01-r-2026',
  state: 'FL',
  district: '01',
  office: 'U.S. House',
  election_date: '2026-08-18',
  cycle: 2026,
  election_type: 'primary' as const,
  primary_party: 'R' as const,
};

const candidates = [
  { id: 'cand-1', name: 'Test Candidate', slug: 'test-candidate', top_stances: [] } as never,
];

const validBody = { race_id: 'race-fl-01-r-2026', free_text: 'I care about the economy.' };

describe('POST /api/match', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readCookieMock.mockResolvedValue('sess-token-abc');
    checkRateLimitsMock.mockResolvedValue({ allowed: true, remaining: 10, retryAfterSeconds: 0 });
    getRaceMock.mockResolvedValue({ ok: true, data: race });
    getCandidatesForRaceMock.mockResolvedValue({ ok: true, data: candidates });
    resolveSessionRowIdMock.mockResolvedValue('sess-row-1');
  });

  it('returns 429 when rate-limited, without reading the race', async () => {
    checkRateLimitsMock.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 20,
      exceeded: 'session',
    });
    const { POST } = await import('@/app/api/match/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(429);
    expect(getRaceMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload with 400', async () => {
    const { POST } = await import('@/app/api/match/route');
    const res = await POST(postRequest({ race_id: '' }));
    expect(res.status).toBe(400);
  });

  it('returns 404 race_not_found for a nonexistent race', async () => {
    getRaceMock.mockResolvedValue({ ok: true, data: null });
    const { POST } = await import('@/app/api/match/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('race_not_found');
  });

  it('returns 502 when the race read itself fails (not a fake not-found)', async () => {
    getRaceMock.mockResolvedValue({ ok: false, error: { kind: 'db_error', message: 'boom' } });
    const { POST } = await import('@/app/api/match/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(502);
  });

  it('returns 404 no_candidates when the race has none', async () => {
    getCandidatesForRaceMock.mockResolvedValue({ ok: true, data: [] });
    const { POST } = await import('@/app/api/match/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('no_candidates');
  });

  it('persists a fresh Haiku result with the Haiku model label and returns its id', async () => {
    matchCandidatesMock.mockResolvedValue({
      ranked: [{ candidate_id: 'cand-1', score: 80, matched_stances: [], rationale: 'aligned' }],
      source: 'haiku',
      cache_hit: false,
      input_tokens: 120,
      output_tokens: 45,
    });
    const table = llmMatchesTable({ existing: null, upsertId: 'match-uuid-1' });
    fromMock.mockReturnValue(table);

    const { POST } = await import('@/app/api/match/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('match-uuid-1');
    expect(json.meta.source).toBe('haiku');
    expect(json.meta.cache_hit).toBe(false);

    expect(table.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 'sess-row-1',
        race_id: 'race-fl-01-r-2026',
        free_text: 'I care about the economy.',
        model: HAIKU_MODEL_LABEL,
        input_tokens: 120,
        output_tokens: 45,
      }),
      { onConflict: 'free_text_hash,race_id' },
    );
  });

  it('persists the heuristic-fallback result with the mock model label — a labeled success, not silently dropped', async () => {
    matchCandidatesMock.mockResolvedValue({
      ranked: [{ candidate_id: 'cand-1', score: 50, matched_stances: [], rationale: 'n/a' }],
      source: 'mock',
      cache_hit: false,
    });
    const table = llmMatchesTable({ existing: null, upsertId: 'match-uuid-2' });
    fromMock.mockReturnValue(table);

    const { POST } = await import('@/app/api/match/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.meta.source).toBe('mock');
    expect(table.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ model: MOCK_MODEL_LABEL, input_tokens: null, output_tokens: null }),
      { onConflict: 'free_text_hash,race_id' },
    );
  });

  it('returns a DB cache hit without calling matchCandidates again', async () => {
    const hash = hashFreeText(validBody.free_text, validBody.race_id);
    void hash; // documents that the lookup is keyed on (free_text_hash, race_id)
    const existingRanked = [{ candidate_id: 'cand-1', score: 70, matched_stances: [], rationale: 'r' }];
    const table = llmMatchesTable({
      existing: {
        id: 'match-uuid-cached',
        model: MOCK_MODEL_LABEL,
        input_tokens: null,
        output_tokens: null,
        ranked_candidates: existingRanked,
      },
    });
    fromMock.mockReturnValue(table);

    const { POST } = await import('@/app/api/match/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('match-uuid-cached');
    expect(json.meta.cache_hit).toBe(true);
    // Cached mock-sourced row must still read as 'mock' — the "estimated
    // match" label must survive a cache hit, not just the first compute.
    expect(json.meta.source).toBe('mock');
    expect(matchCandidatesMock).not.toHaveBeenCalled();
    expect(table.upsert).not.toHaveBeenCalled();
  });

  it('surfaces a persistence failure as 500, never a fake success (id is required for T17 deep-linking)', async () => {
    matchCandidatesMock.mockResolvedValue({
      ranked: [{ candidate_id: 'cand-1', score: 80, matched_stances: [], rationale: 'aligned' }],
      source: 'haiku',
      cache_hit: false,
      input_tokens: 10,
      output_tokens: 5,
    });
    const table = llmMatchesTable({ existing: null, upsertError: { message: 'connection reset' } });
    fromMock.mockReturnValue(table);

    const { POST } = await import('@/app/api/match/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ ok: false, error: 'persist_failed' });
  });

  it('surfaces a matchCandidates failure as 500 match_failed', async () => {
    matchCandidatesMock.mockRejectedValue(new Error('anthropic down'));
    const table = llmMatchesTable({ existing: null });
    fromMock.mockReturnValue(table);

    const { POST } = await import('@/app/api/match/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ ok: false, error: 'match_failed' });
  });
});
