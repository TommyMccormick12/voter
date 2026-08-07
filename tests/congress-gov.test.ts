// Tests for src/lib/api-clients/congress-gov.ts (T10).
//
// Covers:
//   - loud failure when CONGRESS_GOV_API_KEY is unset: every exported
//     network function must reject with a clear, actionable error before
//     attempting any fetch — never silently return an empty result.
//   - shape helpers (normalizeVoteCast, billIdFromHouseVote,
//     billUrlFromHouseVote) — these feed the "no undefined bill ids"
//     invariant fetch_votes.ts enforces at write time.
//
// No real network call happens in this file: the missing-key tests reject
// before fetch() is ever reached (requireEnv throws synchronously inside
// the async function body), and the shape-helper tests are pure functions.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listHouseVotes,
  getHouseVoteMembers,
  getBillDetail,
  normalizeVoteCast,
  billIdFromHouseVote,
  billUrlFromHouseVote,
  getMemberHouseVotes,
  MAX_HOUSE_VOTE_LIST_PAGES,
} from '@/lib/api-clients/congress-gov';
import { fetchCached } from '@/lib/api-clients/base';

// fetchCached is mocked (requireEnv stays real via importActual) so the
// pagination describe block below can drive listHouseVotes through
// multiple fabricated pages with no real network call or disk cache
// write — same pattern as tests/wikidata.test.ts.
vi.mock('@/lib/api-clients/base', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-clients/base')>(
    '@/lib/api-clients/base',
  );
  return {
    ...actual,
    fetchCached: vi.fn(),
  };
});

const mockFetchCached = vi.mocked(fetchCached);

describe('CONGRESS_GOV_API_KEY missing — loud failure, never silent', () => {
  const original = process.env.CONGRESS_GOV_API_KEY;

  beforeEach(() => {
    delete process.env.CONGRESS_GOV_API_KEY;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CONGRESS_GOV_API_KEY;
    else process.env.CONGRESS_GOV_API_KEY = original;
  });

  it('listHouseVotes rejects with a clear message naming the env var', async () => {
    await expect(listHouseVotes(119, 2)).rejects.toThrow(/CONGRESS_GOV_API_KEY/);
  });

  it('getHouseVoteMembers rejects with a clear message naming the env var', async () => {
    await expect(getHouseVoteMembers(119, 2, 1)).rejects.toThrow(/CONGRESS_GOV_API_KEY/);
  });

  it('getBillDetail rejects with a clear message naming the env var (not swallowed into null)', async () => {
    // getBillDetail catches network/parse errors and returns null so a
    // missing bill enrichment doesn't sink the whole ingest run — but a
    // missing API key is a configuration error, not a data miss, and must
    // still surface loudly rather than resolve to null.
    await expect(getBillDetail(119, 'hr', '1234')).rejects.toThrow(/CONGRESS_GOV_API_KEY/);
  });

  it('getMemberHouseVotes (the function fetch_votes.ts actually calls) rejects loudly', async () => {
    await expect(getMemberHouseVotes('F000476', 119, [2], 50)).rejects.toThrow(
      /CONGRESS_GOV_API_KEY/,
    );
  });
});

describe('normalizeVoteCast', () => {
  it('maps Aye/Yea/Yes to yea', () => {
    expect(normalizeVoteCast('Aye')).toBe('yea');
    expect(normalizeVoteCast('Yea')).toBe('yea');
    expect(normalizeVoteCast('Yes')).toBe('yea');
  });

  it('maps Nay/No to nay', () => {
    expect(normalizeVoteCast('Nay')).toBe('nay');
    expect(normalizeVoteCast('No')).toBe('nay');
  });

  it('maps Present to present and Not Voting to absent', () => {
    expect(normalizeVoteCast('Present')).toBe('present');
    expect(normalizeVoteCast('Not Voting')).toBe('absent');
  });

  it('maps an unrecognized value to no_vote rather than throwing', () => {
    expect(normalizeVoteCast('Some New Status')).toBe('no_vote');
  });
});

describe('billIdFromHouseVote', () => {
  it('builds "{type}{number}-{congress}" for a legislation-backed vote', () => {
    expect(
      billIdFromHouseVote({ legislationType: 'HR', legislationNumber: '1234', congress: 119 }),
    ).toBe('hr1234-119');
  });

  it('falls back to the amendment number when there is no legislationType', () => {
    expect(
      billIdFromHouseVote({ amendmentType: 'HAMDT', amendmentNumber: '6', congress: 119 }),
    ).toBe('hamdt6-119');
  });

  it('returns null (never the string "undefined") when neither is present', () => {
    const result = billIdFromHouseVote({ congress: 119 });
    expect(result).toBeNull();
  });
});

describe('listHouseVotes pagination (FIX: a session runs ~700 roll calls, well past ' +
  'the old single 250-row page — every page must be aggregated)', () => {
  const original = process.env.CONGRESS_GOV_API_KEY;

  beforeEach(() => {
    process.env.CONGRESS_GOV_API_KEY = 'test-key';
    mockFetchCached.mockReset();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CONGRESS_GOV_API_KEY;
    else process.env.CONGRESS_GOV_API_KEY = original;
  });

  function item(rollCallNumber: number) {
    return {
      congress: 119,
      sessionNumber: 2,
      rollCallNumber,
      startDate: '2026-01-01',
    };
  }

  it('follows pagination across 3 pages and returns every roll call, in one aggregated list', async () => {
    mockFetchCached.mockImplementation(async (url: unknown) => {
      const offset = new URL(url as string).searchParams.get('offset');
      if (offset === '0') {
        return { houseRollCallVotes: [item(1), item(2)], pagination: { count: 700 } };
      }
      if (offset === '250') {
        return { houseRollCallVotes: [item(3), item(4)], pagination: { count: 700 } };
      }
      if (offset === '500') {
        return { houseRollCallVotes: [item(5), item(6)], pagination: { count: 700 } };
      }
      throw new Error(`test fixture has no page for offset=${offset}`);
    });

    const result = await listHouseVotes(119, 2);

    expect(result.map((r) => r.rollCallNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(mockFetchCached).toHaveBeenCalledTimes(3);
    // Each page must hit a distinct cache entry, so a partial re-run only
    // refetches the missing pages rather than invalidating everything.
    expect(mockFetchCached.mock.calls[0][1]).toMatchObject({
      cacheTag: 'congressgov:house-vote-list:119:2:0',
    });
    expect(mockFetchCached.mock.calls[1][1]).toMatchObject({
      cacheTag: 'congressgov:house-vote-list:119:2:250',
    });
    expect(mockFetchCached.mock.calls[2][1]).toMatchObject({
      cacheTag: 'congressgov:house-vote-list:119:2:500',
    });
  });

  it('stops via the "next" link when the response has no pagination.count', async () => {
    mockFetchCached.mockImplementation(async (url: unknown) => {
      const offset = new URL(url as string).searchParams.get('offset');
      if (offset === '0') {
        return { houseRollCallVotes: [item(1)], pagination: { next: 'https://api.congress.gov/v3/...' } };
      }
      if (offset === '250') {
        return { houseRollCallVotes: [item(2)], pagination: {} }; // no next -> last page
      }
      throw new Error(`test fixture has no page for offset=${offset}`);
    });

    const result = await listHouseVotes(119, 2);

    expect(result.map((r) => r.rollCallNumber)).toEqual([1, 2]);
    expect(mockFetchCached).toHaveBeenCalledTimes(2);
  });

  it('throws loudly instead of silently truncating when pagination never signals the end (page cap)', async () => {
    mockFetchCached.mockImplementation(async () => ({
      houseRollCallVotes: [item(1)],
      pagination: { count: Number.MAX_SAFE_INTEGER },
    }));

    await expect(listHouseVotes(119, 2)).rejects.toThrow(
      new RegExp(`${MAX_HOUSE_VOTE_LIST_PAGES}-page cap`),
    );
    expect(mockFetchCached).toHaveBeenCalledTimes(MAX_HOUSE_VOTE_LIST_PAGES);
  });
});

describe('getHouseVoteMembers wire-key normalization (FIX 2026-08-07: the live API ' +
  'spells the member key bioguideID, not bioguideId — the first live run matched ' +
  'zero members and would have written empty voting records for every incumbent)', () => {
  const original = process.env.CONGRESS_GOV_API_KEY;

  beforeEach(() => {
    process.env.CONGRESS_GOV_API_KEY = 'test-key';
    mockFetchCached.mockReset();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CONGRESS_GOV_API_KEY;
    else process.env.CONGRESS_GOV_API_KEY = original;
  });

  function memberVotesResponse(results: Array<Record<string, unknown>>) {
    return {
      houseRollCallVoteMemberVotes: {
        congress: 119,
        sessionNumber: 2,
        rollCallNumber: 173,
        startDate: '2026-05-14',
        legislationType: 'HR',
        legislationNumber: '42',
        voteQuestion: 'On Passage',
        result: 'Passed',
        results,
      },
    };
  }

  it('normalizes the wire key bioguideID to bioguideId', async () => {
    mockFetchCached.mockResolvedValueOnce(
      memberVotesResponse([
        { bioguideID: 'P000622', firstName: 'Jimmy', lastName: 'Patronis', voteCast: 'Aye' },
      ]),
    );

    const detail = await getHouseVoteMembers(119, 2, 173);

    expect(detail?.members).toHaveLength(1);
    expect(detail?.members[0].bioguideId).toBe('P000622');
    expect(detail?.members[0].voteCast).toBe('Aye');
  });

  it('still accepts camelCase bioguideId if the API ever normalizes its spelling', async () => {
    mockFetchCached.mockResolvedValueOnce(
      memberVotesResponse([{ bioguideId: 'P000622', voteCast: 'Nay' }]),
    );

    const detail = await getHouseVoteMembers(119, 2, 173);

    expect(detail?.members[0].bioguideId).toBe('P000622');
  });

  it('a row with neither spelling maps to an empty id, never undefined (undefined would match an undefined search key)', async () => {
    mockFetchCached.mockResolvedValueOnce(
      memberVotesResponse([{ voteCast: 'Aye' }]),
    );

    const detail = await getHouseVoteMembers(119, 2, 173);

    expect(detail?.members[0].bioguideId).toBe('');
  });

  it('getMemberHouseVotes finds a member through the wire-shaped roster end to end', async () => {
    mockFetchCached.mockImplementation(async (url: unknown) => {
      const u = new URL(url as string);
      if (u.pathname.endsWith('/members')) {
        return memberVotesResponse([
          { bioguideID: 'P000622', voteCast: 'Aye' },
          { bioguideID: 'A000055', voteCast: 'Nay' },
        ]);
      }
      // list page
      return {
        houseRollCallVotes: [
          { congress: 119, sessionNumber: 2, rollCallNumber: 173, startDate: '2026-05-14' },
        ],
        pagination: { count: 1 },
      };
    });

    const votes = await getMemberHouseVotes('P000622', 119, [2], 50);

    expect(votes).toHaveLength(1);
    expect(votes[0].position.bioguideId).toBe('P000622');
    expect(votes[0].position.voteCast).toBe('Aye');
  });
});

describe('billUrlFromHouseVote', () => {
  it('builds a congress.gov bill URL for a known type', () => {
    expect(
      billUrlFromHouseVote({ legislationType: 'HR', legislationNumber: '1234', congress: 119 }),
    ).toBe('https://www.congress.gov/bill/119th-congress/house-bill/1234');
  });

  it('returns null when there is no legislation attached', () => {
    expect(billUrlFromHouseVote({ congress: 119 })).toBeNull();
  });
});
