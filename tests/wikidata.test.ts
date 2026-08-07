// Tests for the Wikidata gate (src/lib/api-clients/wikidata.ts).
//
// Targets Ticket T09 (Spec B1.2): before any Wikipedia read, a candidate
// must resolve a Wikidata QID whose claims (P3602 candidacy-in-election or
// P768 electoral-district) match the race, and survive sanity checks
// (P570 death date, P569 implausible candidacy age).
//
// The Daniel Webster case is the regression target: DATA-AUDIT-2026-08-06.md
// found the FL-11 fixture's "Daniel Webster" candidate carrying the bio of
// the 1782-1852 Massachusetts statesman. This suite proves that even if a
// same-name historical figure's Wikidata entity superficially matches the
// race claims, the death-date sanity check gates it out.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchCached } from '@/lib/api-clients/base';
import { resolveCandidacyQid, type CandidacyQuery } from '@/lib/api-clients/wikidata';

vi.mock('@/lib/api-clients/base', () => ({
  fetchCached: vi.fn(),
}));

const mockFetchCached = vi.mocked(fetchCached);

/** Route the mocked fetchCached by inspecting the Wikidata action param. */
function routeMock(handlers: {
  search?: (url: string) => unknown;
  entities?: (url: string) => unknown; // props includes "claims"
  labels?: (url: string) => unknown; // props is labels|descriptions only
}) {
  mockFetchCached.mockImplementation(async (url: string) => {
    const u = new URL(url);
    const action = u.searchParams.get('action');
    const props = u.searchParams.get('props') ?? '';
    if (action === 'wbsearchentities') {
      return handlers.search?.(url) ?? { search: [] };
    }
    if (action === 'wbgetentities' && props.includes('claims')) {
      return handlers.entities?.(url) ?? { entities: {} };
    }
    if (action === 'wbgetentities') {
      return handlers.labels?.(url) ?? { entities: {} };
    }
    throw new Error(`Unexpected mocked URL: ${url}`);
  });
}

beforeEach(() => {
  mockFetchCached.mockReset();
});

const FL11_HOUSE_2026: CandidacyQuery = {
  name: 'Daniel Webster',
  office: 'U.S. House',
  state: 'FL',
  district: '11',
  cycle: 2026,
};

describe('resolveCandidacyQid', () => {
  describe('Daniel Webster case — same-name dead statesman is gated out', () => {
    it('rejects a QID whose P3602 claim superficially matches but who died before the cycle', async () => {
      // The 1782-1852 statesman entity carries a candidacy claim pointing
      // at an election item that (superficially) reads like the right
      // race — this simulates a bad/ambiguous claim graph. The death-date
      // sanity check must still catch it.
      routeMock({
        search: () => ({
          search: [
            {
              id: 'Q170581',
              label: 'Daniel Webster',
              description: 'American lawyer, orator and statesman (1782-1852)',
            },
          ],
        }),
        entities: () => ({
          entities: {
            Q170581: {
              id: 'Q170581',
              labels: { en: { value: 'Daniel Webster' } },
              descriptions: { en: { value: 'American statesman' } },
              claims: {
                P3602: [{ mainsnak: { datavalue: { value: { id: 'Q900001' } } } }],
                P569: [{ mainsnak: { datavalue: { value: { time: '+1782-01-18T00:00:00Z' } } } }],
                P570: [{ mainsnak: { datavalue: { value: { time: '+1852-10-24T00:00:00Z' } } } }],
              },
              sitelinks: { enwiki: { title: 'Daniel Webster' } },
            },
          },
        }),
        labels: () => ({
          entities: {
            Q900001: {
              labels: {
                en: {
                  value:
                    "2026 United States House of Representatives election in Florida's 11th congressional district",
                },
              },
              descriptions: { en: { value: '' } },
            },
          },
        }),
      });

      const result = await resolveCandidacyQid(FL11_HOUSE_2026);

      expect(result.gated).toBe(true);
      if (result.gated) {
        expect(result.reason).toMatch(/1852/);
        expect(result.reason).toMatch(/death date/i);
      }
    });

    it('rejects when no claims match the race at all (the realistic case: Webster retired, no 2026 candidacy claim exists)', async () => {
      routeMock({
        search: () => ({
          search: [
            {
              id: 'Q170581',
              label: 'Daniel Webster',
              description: 'American lawyer, orator and statesman (1782-1852)',
            },
          ],
        }),
        entities: () => ({
          entities: {
            Q170581: {
              id: 'Q170581',
              labels: { en: { value: 'Daniel Webster' } },
              descriptions: { en: { value: 'American statesman' } },
              claims: {
                P570: [{ mainsnak: { datavalue: { value: { time: '+1852-10-24T00:00:00Z' } } } }],
              },
              sitelinks: { enwiki: { title: 'Daniel Webster' } },
            },
          },
        }),
        labels: () => ({ entities: {} }),
      });

      const result = await resolveCandidacyQid(FL11_HOUSE_2026);

      expect(result.gated).toBe(true);
      if (result.gated) {
        expect(result.reason).toMatch(/no Wikidata QID/i);
      }
    });
  });

  describe('pass case — a real 2026 candidacy verifies and returns the sitelink title', () => {
    it('resolves via P3602 when the election item matches office, state, cycle, and district', async () => {
      routeMock({
        search: () => ({
          search: [{ id: 'Q7176958', label: 'Maxwell Frost', description: 'American politician' }],
        }),
        entities: () => ({
          entities: {
            Q7176958: {
              id: 'Q7176958',
              labels: { en: { value: 'Maxwell Frost' } },
              descriptions: { en: { value: 'American politician' } },
              claims: {
                P3602: [{ mainsnak: { datavalue: { value: { id: 'Q900010' } } } }],
                P569: [{ mainsnak: { datavalue: { value: { time: '+1997-01-17T00:00:00Z' } } } }],
              },
              sitelinks: { enwiki: { title: 'Maxwell Frost' } },
            },
          },
        }),
        labels: () => ({
          entities: {
            Q900010: {
              labels: {
                en: {
                  value:
                    "2026 United States House of Representatives election in Florida's 10th congressional district",
                },
              },
              descriptions: { en: { value: '' } },
            },
          },
        }),
      });

      const result = await resolveCandidacyQid({
        name: 'Maxwell Frost',
        office: 'U.S. House',
        state: 'FL',
        district: '10',
        cycle: 2026,
      });

      expect(result.gated).toBe(false);
      if (!result.gated) {
        expect(result.qid).toBe('Q7176958');
        expect(result.matchedVia).toBe('P3602');
        expect(result.enwikiTitle).toBe('Maxwell Frost');
      }
    });

    it('resolves via P768 when only the electoral-district claim matches', async () => {
      routeMock({
        search: () => ({
          search: [{ id: 'Q1', label: 'Jane Q Candidate', description: 'American politician' }],
        }),
        entities: () => ({
          entities: {
            Q1: {
              id: 'Q1',
              labels: { en: { value: 'Jane Q Candidate' } },
              descriptions: { en: { value: 'American politician' } },
              claims: {
                P768: [{ mainsnak: { datavalue: { value: { id: 'Q900020' } } } }],
              },
              sitelinks: { enwiki: { title: 'Jane Q Candidate' } },
            },
          },
        }),
        labels: () => ({
          entities: {
            Q900020: {
              labels: { en: { value: "Florida's 13th congressional district" } },
              descriptions: { en: { value: 'congressional district' } },
            },
          },
        }),
      });

      const result = await resolveCandidacyQid({
        name: 'Jane Q Candidate',
        office: 'U.S. House',
        state: 'FL',
        district: '13',
        cycle: 2026,
      });

      expect(result.gated).toBe(false);
      if (!result.gated) {
        expect(result.matchedVia).toBe('P768');
      }
    });
  });

  describe('no-QID case', () => {
    it('returns an explicit miss when Wikidata search returns nothing', async () => {
      routeMock({ search: () => ({ search: [] }) });

      const result = await resolveCandidacyQid({
        name: 'Someone Nobody Has Heard Of',
        office: 'U.S. House',
        state: 'FL',
        district: '11',
        cycle: 2026,
      });

      expect(result.gated).toBe(true);
      if (result.gated) {
        expect(result.reason).toMatch(/no Wikidata entity found/i);
      }
    });
  });

  describe('sanity checks beyond the claims match', () => {
    it('rejects a birth date implying an implausible (too young) candidacy age', async () => {
      routeMock({
        search: () => ({
          search: [{ id: 'Q2', label: 'Too Young Candidate', description: 'person' }],
        }),
        entities: () => ({
          entities: {
            Q2: {
              id: 'Q2',
              labels: { en: { value: 'Too Young Candidate' } },
              descriptions: { en: { value: 'person' } },
              claims: {
                P3602: [{ mainsnak: { datavalue: { value: { id: 'Q900030' } } } }],
                // Born 2010 -> 16 in 2026, well under the House minimum of 25.
                P569: [{ mainsnak: { datavalue: { value: { time: '+2010-01-01T00:00:00Z' } } } }],
              },
              sitelinks: {},
            },
          },
        }),
        labels: () => ({
          entities: {
            Q900030: {
              labels: {
                en: {
                  value:
                    "2026 United States House of Representatives election in Florida's 11th congressional district",
                },
              },
              descriptions: { en: { value: '' } },
            },
          },
        }),
      });

      const result = await resolveCandidacyQid(FL11_HOUSE_2026);

      expect(result.gated).toBe(true);
      if (result.gated) {
        expect(result.reason).toMatch(/below the 25-year minimum/i);
      }
    });
  });
});
