import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getCandidatesForRace,
  getCandidateBySlug,
  getCandidateSamplesForRaces,
} from '@/lib/data/candidates';
import { getAnonClient } from '@/lib/data/adapter-anon';

// T16 (Spec C3): candidates.ts must return a typed DataResult instead
// of swallowing a Supabase error into `null` / `[]` / `{}`. These
// tests pin down that a DB outage (`ok: false`) is distinguishable
// from a legitimate empty result.

vi.mock('@/lib/data/adapter-anon', () => ({
  getAnonClient: vi.fn(),
}));

type ChainResult = { data: unknown; error: { message: string } | null };

function makeChain(result: ChainResult) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: ChainResult) => void) => resolve(result),
  };
  return chain;
}

const mockedGetAnonClient = vi.mocked(getAnonClient);

const BASE_CANDIDATE_ROW = {
  id: 'cand-1',
  name: 'Jane Doe',
  slug: 'jane-doe',
  party: 'Republican',
  state: 'FL',
  district: '01',
  race_id: 'race-fl-01-r-2026',
  office: 'U.S. House',
  photo_url: null,
  bio: null,
  website: null,
  active: true,
  primary_party: 'R',
  incumbent: false,
  total_raised: 1000,
  top_stances: [],
};

describe('data/candidates', () => {
  const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
  });

  describe('getCandidatesForRace', () => {
    it('returns ok:false config_error when Supabase env is not configured', async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      const result = await getCandidatesForRace('race-fl-01-r-2026');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('config_error');
    });

    it('returns ok:false db_error on a Supabase error — distinguishable from empty', async () => {
      const from = vi.fn(() => makeChain({ data: null, error: { message: 'connection refused' } }));
      mockedGetAnonClient.mockReturnValue({ from } as unknown as ReturnType<typeof getAnonClient>);
      const result = await getCandidatesForRace('race-fl-01-r-2026');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('db_error');
    });

    it('returns ok:true data:[] when the race has zero active candidates — legitimate empty', async () => {
      const from = vi.fn(() => makeChain({ data: [], error: null }));
      mockedGetAnonClient.mockReturnValue({ from } as unknown as ReturnType<typeof getAnonClient>);
      const result = await getCandidatesForRace('race-fl-01-r-2026');
      expect(result).toEqual({ ok: true, data: [] });
    });

    it('returns the mapped candidates on success', async () => {
      const from = vi.fn(() => makeChain({ data: [BASE_CANDIDATE_ROW], error: null }));
      mockedGetAnonClient.mockReturnValue({ from } as unknown as ReturnType<typeof getAnonClient>);
      const result = await getCandidatesForRace('race-fl-01-r-2026');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data[0]?.slug).toBe('jane-doe');
    });
  });

  describe('getCandidateBySlug', () => {
    it('returns ok:false db_error on a Supabase error', async () => {
      const from = vi.fn(() => makeChain({ data: null, error: { message: 'timeout' } }));
      mockedGetAnonClient.mockReturnValue({ from } as unknown as ReturnType<typeof getAnonClient>);
      const result = await getCandidateBySlug('jane-doe');
      expect(result.ok).toBe(false);
    });

    it('returns ok:true data:null when no active candidate matches — legitimate empty (404)', async () => {
      const from = vi.fn(() => makeChain({ data: null, error: null }));
      mockedGetAnonClient.mockReturnValue({ from } as unknown as ReturnType<typeof getAnonClient>);
      const result = await getCandidateBySlug('nobody');
      expect(result).toEqual({ ok: true, data: null });
    });

    it('returns the full candidate with child relations on success', async () => {
      const row = {
        ...BASE_CANDIDATE_ROW,
        candidate_positions: [],
        candidate_donors: [],
        candidate_top_industries: [],
        candidate_voting_record: [],
        candidate_statements: [],
      };
      const from = vi.fn(() => makeChain({ data: row, error: null }));
      mockedGetAnonClient.mockReturnValue({ from } as unknown as ReturnType<typeof getAnonClient>);
      const result = await getCandidateBySlug('jane-doe');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data?.slug).toBe('jane-doe');
        expect(result.data?.positions).toEqual([]);
      }
    });
  });

  describe('getCandidateSamplesForRaces', () => {
    it('returns ok:true data:{} without querying when raceIds is empty', async () => {
      const result = await getCandidateSamplesForRaces([]);
      expect(result).toEqual({ ok: true, data: {} });
      expect(mockedGetAnonClient).not.toHaveBeenCalled();
    });

    it('returns ok:false db_error on a Supabase error', async () => {
      const from = vi.fn(() => makeChain({ data: null, error: { message: 'timeout' } }));
      mockedGetAnonClient.mockReturnValue({ from } as unknown as ReturnType<typeof getAnonClient>);
      const result = await getCandidateSamplesForRaces(['race-fl-01-r-2026']);
      expect(result.ok).toBe(false);
    });

    it('buckets candidates per race and defaults unmatched races to count:0', async () => {
      const from = vi.fn(() =>
        makeChain({
          data: [{ id: 'c1', name: 'Jane Doe', race_id: 'race-fl-01-r-2026' }],
          error: null,
        })
      );
      mockedGetAnonClient.mockReturnValue({ from } as unknown as ReturnType<typeof getAnonClient>);
      const result = await getCandidateSamplesForRaces(['race-fl-01-r-2026', 'race-fl-02-r-2026']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data['race-fl-01-r-2026']?.count).toBe(1);
        expect(result.data['race-fl-02-r-2026']).toEqual({ count: 0, sample: [] });
      }
    });
  });
});
