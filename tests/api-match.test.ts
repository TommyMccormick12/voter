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
  lookupSessionRowIdMock,
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
  lookupSessionRowIdMock: vi.fn(async () => 'sess-row-1'),
}));

vi.mock('@/lib/cookies', () => ({
  COOKIE_NAMES: { session: 'voter_session', consent: 'voter_consent' },
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
  lookupSessionRowId: lookupSessionRowIdMock,
}));
vi.mock('@/lib/llm/match', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/match')>();
  return { ...actual, matchCandidates: matchCandidatesMock };
});

// The route reads two cookies now: voter_session and voter_consent
// (Finding 1). Default: analytics consent granted, so the pre-existing
// "persists ..." tests below keep exercising the with-consent shape;
// the dedicated no-consent test overrides this per-call.
function mockCookies(opts: { session?: string | undefined; analyticsConsent?: boolean | undefined }) {
  readCookieMock.mockImplementation(async (name: string) => {
    if (name === 'voter_session') return opts.session;
    if (name === 'voter_consent') {
      if (opts.analyticsConsent === undefined) return undefined;
      return JSON.stringify({
        analytics: opts.analyticsConsent,
        data_sale: false,
        marketing: false,
        version: 1,
      });
    }
    return undefined;
  });
}

/**
 * Mocks the `llm_matches` table across BOTH calls runMatch can make to it:
 *  1. `select(...).eq(...).eq(...).maybeSingle()` — the pre-compute cache
 *     lookup by (free_text_hash, race_id).
 *  2. `upsert(..., { ignoreDuplicates: true }).select('id').maybeSingle()`
 *     — Finding 3's DO-NOTHING upsert. `upsertId` set means this request's
 *     insert won (no conflict); left undefined means it conflicted with
 *     an existing row (DO NOTHING), and runMatch falls back to a THIRD
 *     call — another `select(...).eq(...).eq(...).maybeSingle()` — to
 *     find the surviving row, mocked here via `conflictExistingId`.
 */
function llmMatchesTable(opts: {
  existing?: { id: string; model: string; input_tokens: number | null; output_tokens: number | null; ranked_candidates: unknown } | null;
  upsertId?: string;
  upsertError?: unknown;
  conflictExistingId?: string;
}) {
  const maybeSingleCache = vi.fn().mockResolvedValue({ data: opts.existing ?? null, error: null });
  const eq2Cache = vi.fn(() => ({ maybeSingle: maybeSingleCache }));
  const eq1Cache = vi.fn(() => ({ eq: eq2Cache }));

  const maybeSingleConflict = vi.fn().mockResolvedValue({
    data: opts.conflictExistingId ? { id: opts.conflictExistingId } : null,
    error: null,
  });
  const eq2Conflict = vi.fn(() => ({ maybeSingle: maybeSingleConflict }));
  const eq1Conflict = vi.fn(() => ({ eq: eq2Conflict }));

  // First select() call is always the pre-compute cache lookup; a SECOND
  // call only happens on the DO-NOTHING fallback path, and must resolve
  // against the natural-key (free_text_hash, race_id) lookup instead.
  let selectCalls = 0;
  const select = vi.fn(() => {
    selectCalls += 1;
    return selectCalls === 1 ? { eq: eq1Cache } : { eq: eq1Conflict };
  });

  const maybeSingleUpsert = vi.fn().mockResolvedValue({
    data: opts.upsertId ? { id: opts.upsertId } : null,
    error: opts.upsertError ?? null,
  });
  const upsertSelect = vi.fn(() => ({ maybeSingle: maybeSingleUpsert }));
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
    mockCookies({ session: 'sess-token-abc', analyticsConsent: true });
    checkRateLimitsMock.mockResolvedValue({ allowed: true, remaining: 10, retryAfterSeconds: 0 });
    getRaceMock.mockResolvedValue({ ok: true, data: race });
    getCandidatesForRaceMock.mockResolvedValue({ ok: true, data: candidates });
    resolveSessionRowIdMock.mockResolvedValue('sess-row-1');
    lookupSessionRowIdMock.mockResolvedValue('sess-row-1');
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
    expect(json.free_text_hash).toBe(hashFreeText(validBody.free_text, validBody.race_id));

    expect(table.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 'sess-row-1',
        race_id: 'race-fl-01-r-2026',
        free_text: 'I care about the economy.',
        model: HAIKU_MODEL_LABEL,
        input_tokens: 120,
        output_tokens: 45,
      }),
      { onConflict: 'free_text_hash,race_id', ignoreDuplicates: true },
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
      { onConflict: 'free_text_hash,race_id', ignoreDuplicates: true },
    );
  });

  it('returns a DB cache hit without calling matchCandidates again', async () => {
    const hash = hashFreeText(validBody.free_text, validBody.race_id);
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
    expect(json.free_text_hash).toBe(hash);
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

  // Finding 1 — matching still works with no analytics consent, but the
  // persisted row must carry nothing identity-linked or sensitive:
  // session_id null, free_text ''. free_text_hash (the cache key) and
  // ranked_candidates still persist, so the row stays usable for results
  // transport and admin spend stats.
  it('with no analytics consent, persists session_id: null and free_text: "" (no cookie yet)', async () => {
    mockCookies({ session: 'sess-token-abc', analyticsConsent: undefined });
    matchCandidatesMock.mockResolvedValue({
      ranked: [{ candidate_id: 'cand-1', score: 80, matched_stances: [], rationale: 'aligned' }],
      source: 'haiku',
      cache_hit: false,
      input_tokens: 120,
      output_tokens: 45,
    });
    const table = llmMatchesTable({ existing: null, upsertId: 'match-uuid-no-consent' });
    fromMock.mockReturnValue(table);

    const { POST } = await import('@/app/api/match/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('match-uuid-no-consent');

    expect(resolveSessionRowIdMock).not.toHaveBeenCalled();
    expect(table.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: null,
        free_text: '',
        free_text_hash: hashFreeText(validBody.free_text, validBody.race_id),
        race_id: 'race-fl-01-r-2026',
      }),
      { onConflict: 'free_text_hash,race_id', ignoreDuplicates: true },
    );
  });

  it('with an explicit analytics opt-out, also persists session_id: null and free_text: ""', async () => {
    mockCookies({ session: 'sess-token-abc', analyticsConsent: false });
    matchCandidatesMock.mockResolvedValue({
      ranked: [{ candidate_id: 'cand-1', score: 80, matched_stances: [], rationale: 'aligned' }],
      source: 'haiku',
      cache_hit: false,
      input_tokens: 120,
      output_tokens: 45,
    });
    const table = llmMatchesTable({ existing: null, upsertId: 'match-uuid-opt-out' });
    fromMock.mockReturnValue(table);

    const { POST } = await import('@/app/api/match/route');
    await POST(postRequest(validBody));

    expect(table.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: null, free_text: '' }),
      { onConflict: 'free_text_hash,race_id', ignoreDuplicates: true },
    );
  });

  // Finding 3 — ON CONFLICT DO NOTHING (ignoreDuplicates: true): a
  // concurrent identical request must never rewrite an existing row's
  // session_id (which would transfer ownership and break the prior
  // owner's saved link). When the upsert inserts nothing, runMatch must
  // select the surviving row by (free_text_hash, race_id) and return ITS
  // id — not silently fail, and not fabricate an id of its own.
  it('on a DO-NOTHING conflict, returns the surviving row id and never rewrites it', async () => {
    matchCandidatesMock.mockResolvedValue({
      ranked: [{ candidate_id: 'cand-1', score: 80, matched_stances: [], rationale: 'aligned' }],
      source: 'haiku',
      cache_hit: false,
      input_tokens: 120,
      output_tokens: 45,
    });
    // upsertId omitted: the ignoreDuplicates upsert inserts nothing
    // (another session's row already exists for this natural key).
    const table = llmMatchesTable({
      existing: null,
      conflictExistingId: 'match-uuid-prior-owner',
    });
    fromMock.mockReturnValue(table);

    const { POST } = await import('@/app/api/match/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    // The surviving row's id — the prior owner's row — not a fabricated
    // id and not a 500.
    expect(json.id).toBe('match-uuid-prior-owner');
    expect(table.upsert).toHaveBeenCalledWith(
      expect.anything(),
      { onConflict: 'free_text_hash,race_id', ignoreDuplicates: true },
    );
  });

  it('surfaces persist_failed if a DO-NOTHING conflict leaves no row to find (should not happen, but must not fake success)', async () => {
    matchCandidatesMock.mockResolvedValue({
      ranked: [{ candidate_id: 'cand-1', score: 80, matched_stances: [], rationale: 'aligned' }],
      source: 'haiku',
      cache_hit: false,
      input_tokens: 120,
      output_tokens: 45,
    });
    const table = llmMatchesTable({ existing: null }); // no upsertId, no conflictExistingId
    fromMock.mockReturnValue(table);

    const { POST } = await import('@/app/api/match/route');
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ ok: false, error: 'persist_failed' });
  });
});

describe('getMatchById', () => {
  const MATCH_ID = '11111111-1111-1111-1111-111111111111';
  const OWNER_ROW_ID = 'sess-row-owner';
  const OTHER_ROW_ID = 'sess-row-other';
  const FREE_TEXT_HASH = 'hash-of-the-free-text';

  function llmMatchesRowTable(row: Record<string, unknown> | null) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    return { select };
  }

  function baseRow(overrides: Record<string, unknown>) {
    return {
      id: MATCH_ID,
      race_id: 'race-fl-01-r-2026',
      session_id: OTHER_ROW_ID,
      free_text: 'the actual free text',
      free_text_hash: FREE_TEXT_HASH,
      model: HAIKU_MODEL_LABEL,
      input_tokens: 100,
      output_tokens: 40,
      ranked_candidates: [{ candidate_id: 'cand-1', score: 80, matched_stances: [], rationale: 'r' }],
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    lookupSessionRowIdMock.mockResolvedValue(OWNER_ROW_ID);
  });

  it('case (a): allows and blanks free_text when the row has no session_id', async () => {
    const table = llmMatchesRowTable(baseRow({ session_id: null }));
    fromMock.mockReturnValue(table);

    const { getMatchById } = await import('@/lib/app/match');
    const result = await getMatchById(MATCH_ID, 'requester-token', null);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.match.freeText).toBe('');
    }
  });

  it('case (b): allows and renders free_text when the row belongs to the requester\'s own session', async () => {
    const table = llmMatchesRowTable(baseRow({ session_id: OWNER_ROW_ID }));
    fromMock.mockReturnValue(table);

    const { getMatchById } = await import('@/lib/app/match');
    const result = await getMatchById(MATCH_ID, 'requester-token', null);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.match.freeText).toBe('the actual free text');
    }
  });

  it('case (c): allows and STILL blanks free_text when only the hash proves knowledge of a different session\'s row', async () => {
    const table = llmMatchesRowTable(baseRow({ session_id: OTHER_ROW_ID }));
    fromMock.mockReturnValue(table);

    const { getMatchById } = await import('@/lib/app/match');
    const result = await getMatchById(MATCH_ID, 'requester-token', FREE_TEXT_HASH);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Access granted via the hash, but never the other owner's free_text.
      expect(result.match.freeText).toBe('');
    }
  });

  it('deny case: wrong session and no (or wrong) hash returns forbidden', async () => {
    const table = llmMatchesRowTable(baseRow({ session_id: OTHER_ROW_ID }));
    fromMock.mockReturnValue(table);

    const { getMatchById } = await import('@/lib/app/match');
    const noHash = await getMatchById(MATCH_ID, 'requester-token', null);
    expect(noHash).toEqual({ ok: false, code: 'forbidden', status: 403 });

    const wrongHash = await getMatchById(MATCH_ID, 'requester-token', 'not-the-real-hash');
    expect(wrongHash).toEqual({ ok: false, code: 'forbidden', status: 403 });
  });
});
