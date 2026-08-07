// Tests for the vote-attachment logic in scripts/ingest/fetch_votes.ts (T10).
//
// Covers:
//   - the two loud-failure invariants spec B1 tail / B4 require:
//     no undefined bill_ids, no YEA+NAY contradiction on one bill_id.
//   - attachVotingRecords: ID-only crosswalk (fec_candidate_id ->
//     bioguide via the injected Map, never a name comparison), house vs.
//     senate source routing, and the "no bioguide match = challenger,
//     empty voting_record" path.
//
// src/lib/api-clients/congress-gov and voteview are mocked so no real
// network call or disk cache write happens — same pattern as
// tests/fetch_fec.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  attachVotingRecords,
  assertNoUndefinedBillIds,
  assertNoYeaNayContradiction,
  type VoteCandidate,
  type VoteRecordRow,
} from '../scripts/ingest/fetch_votes';
import { getMemberHouseVotes } from '@/lib/api-clients/congress-gov';
import { getMemberSenateVotes } from '@/lib/api-clients/voteview';

vi.mock('@/lib/api-clients/congress-gov', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-clients/congress-gov')>(
    '@/lib/api-clients/congress-gov',
  );
  return {
    ...actual,
    getMemberHouseVotes: vi.fn(),
  };
});

vi.mock('@/lib/api-clients/voteview', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-clients/voteview')>(
    '@/lib/api-clients/voteview',
  );
  return {
    ...actual,
    getMemberSenateVotes: vi.fn(),
  };
});

const mockedGetMemberHouseVotes = vi.mocked(getMemberHouseVotes);
const mockedGetMemberSenateVotes = vi.mocked(getMemberSenateVotes);

// Default roll_call_id is derived from bill_id so tests that only override
// bill_id/vote keep their old meaning (same bill_id -> same roll call,
// matching every pre-existing test below). Tests that need to prove the
// roll-call-identity fix — two distinct roll calls sharing one bill_id, or
// two different bill_ids from the SAME roll call — pass roll_call_id
// explicitly.
function row(overrides: Partial<VoteRecordRow> = {}): VoteRecordRow {
  const billId = overrides.bill_id ?? 'hr1-119';
  return {
    bill_id: billId,
    bill_title: 'Test Act',
    bill_summary: null,
    vote: 'yea',
    issue_slugs: [],
    vote_date: '2026-01-01',
    source: 'congress_gov',
    source_url: null,
    significance: 'major',
    roll_call_id: `house-119-2-${billId}`,
    ...overrides,
  };
}

describe('assertNoUndefinedBillIds (spec B1 tail: eliminate "vote-undefined" ids)', () => {
  it('passes when every row has a real bill_id', () => {
    expect(() => assertNoUndefinedBillIds([row({ bill_id: 'hr1-119' })], 'X')).not.toThrow();
  });

  it('throws on a literal "undefined" bill_id (the historical bug)', () => {
    expect(() => assertNoUndefinedBillIds([row({ bill_id: 'vote-undefined' })], 'X')).toThrow(
      /invalid bill_id/,
    );
  });

  it('throws on an empty-string bill_id', () => {
    expect(() => assertNoUndefinedBillIds([row({ bill_id: '' })], 'X')).toThrow(/invalid bill_id/);
  });

  it('throws on a null bill_id even though the type says string', () => {
    const rows = [row({ bill_id: null as unknown as string })];
    expect(() => assertNoUndefinedBillIds(rows, 'X')).toThrow(/invalid bill_id/);
  });

  it('includes the candidate label in the error for triage', () => {
    expect(() => assertNoUndefinedBillIds([row({ bill_id: '' })], 'Royal Webster')).toThrow(
      /Royal Webster/,
    );
  });
});

describe('assertNoYeaNayContradiction (DATA-AUDIT: 89 YEA+NAY pairs on one bill)', () => {
  it('passes when every bill_id has a single consistent vote across rows', () => {
    const rows = [row({ bill_id: 'hr1-119', vote: 'yea' }), row({ bill_id: 'hr2-119', vote: 'nay' })];
    expect(() => assertNoYeaNayContradiction(rows, 'X')).not.toThrow();
  });

  it('passes when the same bill_id repeats with the same vote (duplicate, not a contradiction)', () => {
    const rows = [row({ bill_id: 'hr1-119', vote: 'yea' }), row({ bill_id: 'hr1-119', vote: 'yea' })];
    expect(() => assertNoYeaNayContradiction(rows, 'X')).not.toThrow();
  });

  it('throws when the same bill_id shows both yea and nay', () => {
    const rows = [row({ bill_id: 'hr1-119', vote: 'yea' }), row({ bill_id: 'hr1-119', vote: 'nay' })];
    expect(() => assertNoYeaNayContradiction(rows, 'X')).toThrow(/contradictory positions/);
  });

  it('throws regardless of which contradictory value came first', () => {
    const rows = [row({ bill_id: 'hr1-119', vote: 'nay' }), row({ bill_id: 'hr1-119', vote: 'yea' })];
    expect(() => assertNoYeaNayContradiction(rows, 'X')).toThrow(/contradictory positions/);
  });

  it('includes the candidate label and bill_id in the error for triage', () => {
    const rows = [row({ bill_id: 'hr7567-119', vote: 'yea' }), row({ bill_id: 'hr7567-119', vote: 'nay' })];
    expect(() => assertNoYeaNayContradiction(rows, 'Royal Webster')).toThrow(
      /Royal Webster[\s\S]*hr7567-119/,
    );
  });

  it('keys on roll_call_id, not bill_id: a Nay on the Motion to Recommit and a Yea on ' +
    'Passage of the SAME bill (two distinct roll calls) is routine and does not throw', () => {
    const rows = [
      row({ bill_id: 'hr7567-119', roll_call_id: 'house-119-2-410', vote: 'nay' }), // MTR
      row({ bill_id: 'hr7567-119', roll_call_id: 'house-119-2-411', vote: 'yea' }), // Passage
    ];
    expect(() => assertNoYeaNayContradiction(rows, 'X')).not.toThrow();
  });

  it('still throws for a genuine contradiction on the SAME roll call, even when bill_id ' +
    'happens to differ (proves the key is roll_call_id, not bill_id)', () => {
    const rows = [
      row({ bill_id: 'hr7567-119', roll_call_id: 'house-119-2-410', vote: 'yea' }),
      row({ bill_id: 'hr9999-119', roll_call_id: 'house-119-2-410', vote: 'nay' }),
    ];
    expect(() => assertNoYeaNayContradiction(rows, 'X')).toThrow(/contradictory positions/);
  });
});

describe('attachVotingRecords (ID-only crosswalk, no name matching)', () => {
  beforeEach(() => {
    mockedGetMemberHouseVotes.mockReset();
    mockedGetMemberSenateVotes.mockReset();
  });

  it('resolves bioguide strictly via the fec_candidate_id -> bioguide map, never by name', async () => {
    mockedGetMemberHouseVotes.mockResolvedValueOnce([]);
    const candidates: VoteCandidate[] = [
      { name: 'Royal Webster', fec_candidate_id: 'H9FL11777' },
    ];
    // The map deliberately does NOT contain 'H9FL11777' — Royal Webster is
    // a challenger. Even though a same-lastname incumbent ("Daniel
    // Webster") could exist elsewhere in a name-matching world, no name is
    // ever consulted here, so there is nothing that could cause a
    // cross-candidate mismatch.
    const fecToBioguide = new Map<string, string>([['H0FL11999', 'W000806']]);

    await attachVotingRecords(candidates, fecToBioguide, { chamber: 'house' });

    expect(mockedGetMemberHouseVotes).not.toHaveBeenCalled();
    expect(candidates[0].incumbent).toBe(false);
    expect(candidates[0].voting_record).toEqual([]);
    expect(candidates[0].bioguide_id).toBeUndefined();
  });

  it('attaches the incumbent bioguide and fetches House votes when the fec id is in the map', async () => {
    mockedGetMemberHouseVotes.mockResolvedValueOnce([
      {
        vote: {
          congress: 119,
          sessionNumber: 2,
          rollCallNumber: 155,
          startDate: '2026-04-30T00:00:00Z',
          legislationType: 'S',
          legislationNumber: '4465',
          voteQuestion: 'On Passage',
          result: 'Passed',
          members: [],
        },
        position: { bioguideId: 'W000806', voteCast: 'Aye' },
      },
    ]);
    const candidates: VoteCandidate[] = [
      { name: 'Daniel Webster', fec_candidate_id: 'H0FL11999' },
    ];
    const fecToBioguide = new Map<string, string>([['H0FL11999', 'W000806']]);

    await attachVotingRecords(candidates, fecToBioguide, { chamber: 'house' });

    expect(mockedGetMemberHouseVotes).toHaveBeenCalledWith('W000806', 119, [2, 1], 50);
    expect(candidates[0].incumbent).toBe(true);
    expect(candidates[0].bioguide_id).toBe('W000806');
    expect(candidates[0].voting_record).toHaveLength(1);
    expect(candidates[0].voting_record?.[0]).toMatchObject({
      bill_id: 's4465-119',
      vote: 'yea',
      source: 'congress_gov',
    });
    expect(mockedGetMemberSenateVotes).not.toHaveBeenCalled();
  });

  it('routes to Voteview for chamber "senate" and never calls the House client', async () => {
    mockedGetMemberSenateVotes.mockResolvedValueOnce([
      {
        rollCall: {
          congress: 119,
          chamber: 'Senate',
          rollnumber: 1,
          date: '2025-01-09',
          bill_number: 'S5',
          vote_result: 'Cloture Motion Agreed to',
          vote_desc: 'A bill to require...',
          vote_question: 'On the Cloture Motion',
        },
        cast_code: 6,
      },
    ]);
    const candidates: VoteCandidate[] = [{ name: 'Ashley Moody', fec_candidate_id: 'S6FL00312' }];
    const fecToBioguide = new Map<string, string>([['S6FL00312', 'M001244']]);

    await attachVotingRecords(candidates, fecToBioguide, { chamber: 'senate' });

    expect(mockedGetMemberSenateVotes).toHaveBeenCalledWith('M001244', 119, 50);
    expect(mockedGetMemberHouseVotes).not.toHaveBeenCalled();
    expect(candidates[0].voting_record?.[0]).toMatchObject({
      bill_id: 's5-119',
      vote: 'nay',
      source: 'voteview',
    });
  });

  it('marks a candidate with no fec_candidate_id at all as a non-incumbent with no record', async () => {
    const candidates: VoteCandidate[] = [{ name: 'Some Write-In Candidate' }];
    const fecToBioguide = new Map<string, string>();

    await attachVotingRecords(candidates, fecToBioguide, { chamber: 'house' });

    expect(candidates[0].incumbent).toBe(false);
    expect(candidates[0].voting_record).toEqual([]);
    expect(mockedGetMemberHouseVotes).not.toHaveBeenCalled();
  });

  it('propagates the YEA/NAY contradiction guard as a thrown error, aborting the write', async () => {
    mockedGetMemberHouseVotes.mockResolvedValueOnce([
      {
        vote: {
          congress: 119,
          sessionNumber: 2,
          rollCallNumber: 1,
          startDate: '2026-01-01T00:00:00Z',
          legislationType: 'HR',
          legislationNumber: '1',
          voteQuestion: 'On Passage',
          members: [],
        },
        position: { bioguideId: 'X000000', voteCast: 'Aye' },
      },
      {
        vote: {
          congress: 119,
          sessionNumber: 2,
          rollCallNumber: 1,
          startDate: '2026-01-01T00:00:00Z',
          legislationType: 'HR',
          legislationNumber: '1',
          voteQuestion: 'On Passage',
          members: [],
        },
        position: { bioguideId: 'X000000', voteCast: 'No' },
      },
    ]);
    const candidates: VoteCandidate[] = [{ name: 'Duplicate Vote Bug', fec_candidate_id: 'H1TEST01' }];
    const fecToBioguide = new Map<string, string>([['H1TEST01', 'X000000']]);

    await expect(
      attachVotingRecords(candidates, fecToBioguide, { chamber: 'house' }),
    ).rejects.toThrow(/contradictory positions/);
  });

  it('end to end: a Nay on the Motion to Recommit and a Yea on Passage of the same ' +
    'bill (two distinct roll calls) both land in voting_record with no throw — the ' +
    'fixture shape tolerates duplicate bill_id rows (no unique(candidate,bill_id) ' +
    'constraint downstream in supabase/migrations/004_primary_pivot.sql, and ' +
    'seed_candidates.ts keys DB rows by an auto-generated uuid, not bill_id)', async () => {
    mockedGetMemberHouseVotes.mockResolvedValueOnce([
      {
        vote: {
          congress: 119,
          sessionNumber: 2,
          rollCallNumber: 410,
          startDate: '2026-03-01T00:00:00Z',
          legislationType: 'HR',
          legislationNumber: '7567',
          voteQuestion: 'On Motion to Recommit',
          result: 'Failed',
          members: [],
        },
        position: { bioguideId: 'X000001', voteCast: 'No' },
      },
      {
        vote: {
          congress: 119,
          sessionNumber: 2,
          rollCallNumber: 411,
          startDate: '2026-03-01T00:00:00Z',
          legislationType: 'HR',
          legislationNumber: '7567',
          voteQuestion: 'On Passage',
          result: 'Passed',
          members: [],
        },
        position: { bioguideId: 'X000001', voteCast: 'Aye' },
      },
    ]);
    const candidates: VoteCandidate[] = [{ name: 'MTR Then Passage', fec_candidate_id: 'H1TEST02' }];
    const fecToBioguide = new Map<string, string>([['H1TEST02', 'X000001']]);

    await expect(
      attachVotingRecords(candidates, fecToBioguide, { chamber: 'house' }),
    ).resolves.not.toThrow();

    const rows = candidates[0].voting_record ?? [];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.bill_id === 'hr7567-119')).toBe(true);
    expect(rows.map((r) => r.vote).sort()).toEqual(['nay', 'yea']);
    expect(new Set(rows.map((r) => r.roll_call_id)).size).toBe(2);
  });
});
