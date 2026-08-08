import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getRace,
  getRacesByIds,
  getRacesForZip,
  getRacesForDistrict,
  getRacesForDistricts,
  getDistrictsForZip,
  isZipCovered,
} from '@/lib/data/races';
import { getAnonClient } from '@/lib/data/adapter-anon';

// T16 (Spec C3): races.ts must return a typed DataResult instead of
// swallowing a Supabase error into `null` / `[]`. These tests pin down
// that a DB outage (`ok: false`) is distinguishable from a legitimate
// empty result (`ok: true, data: []` / `data: null`).
//
// T06 (Spec A3/A5): the crosswalk-backed contract. `getDistrictsForZip`
// must classify a zip as single / split / out_of_coverage without ever
// silently defaulting a split zip to its majority-share entry — that
// was the exact bug this ticket replaces. `getRacesForDistrict` /
// `getRacesForDistricts` must include the statewide Senate races and
// must NOT include Governor (Spec A4 / Decision 8).

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

    it('returns the mapped race on success and defaults a missing no_primary value to false', async () => {
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
      if (result.ok) {
        expect(result.data?.id).toBe('race-fl-01-r-2026');
        expect(result.data?.no_primary).toBe(false);
        expect(result.data?.no_primary_note).toBeNull();
      }
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

  describe('getDistrictsForZip / isZipCovered', () => {
    it('classifies an out-of-coverage zip without touching the DB', () => {
      expect(getDistrictsForZip('90210')).toEqual({ kind: 'out_of_coverage' });
      expect(getDistrictsForZip('10001')).toEqual({ kind: 'out_of_coverage' });
      expect(isZipCovered('90210')).toBe(false);
    });

    it('classifies a single-district zip (32502, Pensacola -> FL-01)', () => {
      expect(getDistrictsForZip('32502')).toEqual({ kind: 'single', district: '01' });
      expect(isZipCovered('32502')).toBe(true);
    });

    it('classifies a genuinely split zip (33142, Miami -> FL-24/FL-26) without picking a "winner"', () => {
      const resolution = getDistrictsForZip('33142');
      expect(resolution.kind).toBe('split');
      if (resolution.kind === 'split') {
        expect(resolution.districts).toEqual(expect.arrayContaining(['24', '26']));
        expect(resolution.districts).toHaveLength(2);
      }
      expect(isZipCovered('33142')).toBe(true);
    });

    it('classifies the other audit split zip (32822, Orlando -> FL-09/FL-10)', () => {
      const resolution = getDistrictsForZip('32822');
      expect(resolution.kind).toBe('split');
      if (resolution.kind === 'split') {
        expect(resolution.districts).toEqual(expect.arrayContaining(['09', '10']));
      }
    });
  });

  describe('getRacesForDistrict', () => {
    it('queries House R/D for the district plus statewide Senate R/D — no Governor ids', async () => {
      const from = vi.fn(() => makeChain({ data: [], error: null }));
      mockedGetAnonClient.mockReturnValue({ from } as unknown as ReturnType<typeof getAnonClient>);
      const chain = makeChain({ data: [], error: null });
      const inSpy = vi.fn((_column: string, _ids: string[]) => chain);
      chain.in = inSpy;
      from.mockReturnValue(chain);

      const result = await getRacesForDistrict('10');
      expect(result.ok).toBe(true);
      expect(from).toHaveBeenCalledWith('races');
      expect(inSpy).toHaveBeenCalledWith('id', [
        'race-fl-10-r-2026',
        'race-fl-10-d-2026',
        'race-fl-sen-r-2026',
        'race-fl-sen-d-2026',
      ]);
    });

    it('never includes a race-fl-gov id (Spec A4 / Decision 8 — no Governor surface)', async () => {
      const chain = makeChain({ data: [], error: null });
      const inSpy = vi.fn((_column: string, _ids: string[]) => chain);
      chain.in = inSpy;
      const from = vi.fn(() => chain);
      mockedGetAnonClient.mockReturnValue({ from } as unknown as ReturnType<typeof getAnonClient>);

      await getRacesForDistrict('01');
      const calledIds = inSpy.mock.calls[0]?.[1] as string[];
      expect(calledIds.some((id) => id.includes('gov'))).toBe(false);
    });
  });

  describe('getRacesForDistricts (explicit "show all N districts" fallback)', () => {
    it('unions House races across districts and counts the statewide Senate race ids once', async () => {
      const chain = makeChain({ data: [], error: null });
      const inSpy = vi.fn((_column: string, _ids: string[]) => chain);
      chain.in = inSpy;
      const from = vi.fn(() => chain);
      mockedGetAnonClient.mockReturnValue({ from } as unknown as ReturnType<typeof getAnonClient>);

      await getRacesForDistricts(['24', '26']);
      const calledIds = inSpy.mock.calls[0]?.[1] as string[];
      expect(calledIds).toEqual(
        expect.arrayContaining([
          'race-fl-24-r-2026',
          'race-fl-24-d-2026',
          'race-fl-26-r-2026',
          'race-fl-26-d-2026',
          'race-fl-sen-r-2026',
          'race-fl-sen-d-2026',
        ])
      );
      // Senate ids appear exactly once each even though there are 2 districts.
      expect(calledIds.filter((id) => id === 'race-fl-sen-r-2026')).toHaveLength(1);
      expect(calledIds.filter((id) => id === 'race-fl-sen-d-2026')).toHaveLength(1);
    });
  });

  describe('getRacesForZip', () => {
    it('returns ok:true data:[] for an out-of-coverage zip without querying', async () => {
      const result = await getRacesForZip('00000');
      expect(result).toEqual({ ok: true, data: [] });
      expect(mockedGetAnonClient).not.toHaveBeenCalled();
    });

    it('resolves a single-district zip straight to its races', async () => {
      const chain = makeChain({ data: [], error: null });
      const inSpy = vi.fn((_column: string, _ids: string[]) => chain);
      chain.in = inSpy;
      const from = vi.fn(() => chain);
      mockedGetAnonClient.mockReturnValue({ from } as unknown as ReturnType<typeof getAnonClient>);

      const result = await getRacesForZip('32502');
      expect(result.ok).toBe(true);
      expect(from).toHaveBeenCalledWith('races');
      expect(inSpy).toHaveBeenCalledWith('id', [
        'race-fl-01-r-2026',
        'race-fl-01-d-2026',
        'race-fl-sen-r-2026',
        'race-fl-sen-d-2026',
      ]);
    });

    it('never guesses a district for a split zip — returns ok:true data:[] without querying', async () => {
      const result = await getRacesForZip('33142');
      expect(result).toEqual({ ok: true, data: [] });
      expect(mockedGetAnonClient).not.toHaveBeenCalled();
    });
  });
});
