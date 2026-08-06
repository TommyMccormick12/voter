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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  listHouseVotes,
  getHouseVoteMembers,
  getBillDetail,
  normalizeVoteCast,
  billIdFromHouseVote,
  billUrlFromHouseVote,
  getMemberHouseVotes,
} from '@/lib/api-clients/congress-gov';

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
