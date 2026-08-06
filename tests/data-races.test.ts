import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getRace, getRacesByIds, getRacesForZip, isZipCovered } from '@/lib/data/races';
import { getAnonClient } from '@/lib/data/adapter-anon';

// T16 (Spec C3): races.ts must return a typed DataResult instead of
// swallowing a Supabase error into `null` / `[]`. These tests pin down
// that a DB outage (`ok: false`) is distinguishable from a legitimate
// empty result (`ok: true, data: []` / `data: null`).

vi.mock('@/lib/data/adapter-anon', () => ({
  getAnonClient: vi.fn(),
}));

type ChainResult = { data: unknown; error: { message: string } | null };

/**
 * Minimal chainable Supabase query-builder mock. Every chain method
 * returns the same object so any call order works; adding a `.then`
 * makes `await chain` resolve to `result` directly for call sites that
 * don't call a terminal method like `.maybeSingle()`.
 */
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

describe('data/races', () => {
  const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
  });

  describe('getRace', () => {
    it('returns ok:false config_error when Supabase env is not configured', async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      const result = await getRace('race-fl-01-r-2026');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('config_error');
    });

    it('returns ok:false db_error on a Supabase error — distinguishable from empty', async () => {
      const from = vi.fn(() => makeChain({ data: null, error: { message: 'connection refused' } }));
      mockedGetAnonClient.mockReturnValue({ from } as unknown as ReturnType<typeof getAnonClient>);
      const result = await getRace('race-fl-01-r-2026');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('db_error');
    });

    it('returns ok:true data:null when no row matches — legitimate empty, not an error', async () => {
      const from = vi.fn(() => makeChain({ data: null, error: null }));
      mockedGetAnonClient.mockReturnValue({ from } as unknown as ReturnType<typeof getAnonClient>);
      const result = await getRace('nope');
      expect(result).toEqual({ ok: true, data: null });
    });

    it('returns the mapped race on success', async () => {
      const row = {
        id: 'race-fl-01-r-2026',
        state: 'FL',
        district: '01',
        office: 'U.S. House',
        election_date: '2026-08-18',
        cycle: 2026,
        election_type: 'primary',
        primary_party: 'R',
      };
      const from = vi.fn(() => makeChain({ data: row, error: null }));
      mockedGetAnonClient.mockReturnValue({ from } as unknown as ReturnType<typeof getAnonClient>);
      const result = await getRace('race-fl-01-r-2026');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data?.id).toBe('race-fl-01-r-2026');
    });
  });

  describe('getRacesByIds', () => {
    it('returns ok:true data:[] without querying when ids is empty', async () => {
      const result = await getRacesByIds([]);
      expect(result).toEqual({ ok: true, data: [] });
      expect(mockedGetAnonClient).not.toHaveBeenCalled();
    });

    it('returns ok:false db_error on a Supabase error', async () => {
      const from = vi.fn(() => makeChain({ data: null, error: { message: 'timeout' } }));
      mockedGetAnonClient.mockReturnValue({ from } as unknown as ReturnType<typeof getAnonClient>);
      const result = await getRacesByIds(['race-fl-01-r-2026']);
      expect(result.ok).toBe(false);
    });

    it('preserves input id order and drops ids missing from the DB', async () => {
      const rows = [
        { id: 'b', state: 'FL', district: null, office: 'U.S. Senate', election_date: '2026-08-18', cycle: 2026, election_type: 'primary', primary_party: 'D' },
        { id: 'a', state: 'FL', district: null, office: 'U.S. Senate', election_date: '2026-08-18', cycle: 2026, election_type: 'primary', primary_party: 'R' },
      ];
      const from = vi.fn(() => makeChain({ data: rows, error: null }));
      mockedGetAnonClient.mockReturnValue({ from } as unknown as ReturnType<typeof getAnonClient>);
      const result = await getRacesByIds(['a', 'missing', 'b']);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.map((r) => r.id)).toEqual(['a', 'b']);
    });
  });

  describe('isZipCovered / getRacesForZip', () => {
    it('isZipCovered is false for a zip outside FL district coverage', () => {
      expect(isZipCovered('00000')).toBe(false);
    });

    it('getRacesForZip returns ok:true data:[] for an out-of-coverage zip without querying', async () => {
      const result = await getRacesForZip('00000');
      expect(result).toEqual({ ok: true, data: [] });
      expect(mockedGetAnonClient).not.toHaveBeenCalled();
    });

    it('isZipCovered is true and getRacesForZip queries the district races for a covered zip', async () => {
      expect(isZipCovered('32003')).toBe(true);
      const from = vi.fn(() => makeChain({ data: [], error: null }));
      mockedGetAnonClient.mockReturnValue({ from } as unknown as ReturnType<typeof getAnonClient>);
      const result = await getRacesForZip('32003');
      expect(result.ok).toBe(true);
      expect(from).toHaveBeenCalledWith('races');
    });
  });
});
