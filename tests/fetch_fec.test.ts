// Tests for the money-attachment logic in scripts/ingest/fetch_fec.ts (T11).
//
// Covers:
//   - candidate_id-only attachment: a candidate without fec_candidate_id
//     is skipped; getCandidateTotals is never called with a name-derived
//     or guessed ID (there is no name-based search/attachment path left
//     to test against — this suite proves it by asserting the mock is
//     only ever called with the exact candidate_id already on the record).
//   - cycle-pinned, no-fallback behavior: when FEC has no rows for the
//     requested cycle, the result is the explicit `{ no2026Filings: true }`
//     marker, never a second attempt at a different cycle, and never a
//     stale total_raised left over from a previous run.
//   - coverage_end_date is carried into the fixture's fec_totals shape.
//
// src/lib/api-clients/fec is mocked so no real network call or disk cache
// write happens; getCandidateTotals is the only export attachFecTotals
// calls, so mocking it in isolation is sufficient.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attachFecTotals, type MoneyCandidate } from '../scripts/ingest/fetch_fec';
import { getCandidateTotals } from '@/lib/api-clients/fec';

vi.mock('@/lib/api-clients/fec', () => ({
  getCandidateTotals: vi.fn(),
  searchCandidates: vi.fn(),
}));

const mockedGetCandidateTotals = vi.mocked(getCandidateTotals);

function totals(overrides: Partial<Awaited<ReturnType<typeof getCandidateTotals>>> = {}) {
  return {
    committee_id: 'C00123456',
    cycle: 2026,
    receipts: 100000,
    disbursements: 40000,
    cash_on_hand_end_period: 60000,
    individual_contributions: 80000,
    other_political_committee_contributions: 20000,
    coverage_end_date: '2026-06-30',
    ...overrides,
  };
}

describe('attachFecTotals (T11: candidate_id-only, cycle-pinned money)', () => {
  beforeEach(() => {
    mockedGetCandidateTotals.mockReset();
  });

  it('fetches totals by fec_candidate_id and stores total_raised + fec_totals', async () => {
    mockedGetCandidateTotals.mockResolvedValueOnce(totals());
    const candidates: MoneyCandidate[] = [
      { name: 'Darren Soto', fec_candidate_id: 'H6FL09179' },
    ];

    await attachFecTotals(candidates, { cycle: 2026, office: 'H' });

    expect(mockedGetCandidateTotals).toHaveBeenCalledTimes(1);
    expect(mockedGetCandidateTotals).toHaveBeenCalledWith('H6FL09179', {
      cycle: 2026,
      office: 'H',
    });
    expect(candidates[0].total_raised).toBe(100000);
    expect(candidates[0].fec_totals).toEqual(totals());
  });

  it('carries coverage_end_date through into fec_totals and the top-level fec_coverage_end_date', async () => {
    mockedGetCandidateTotals.mockResolvedValueOnce(totals({ coverage_end_date: '2026-07-29' }));
    const candidates: MoneyCandidate[] = [
      { name: 'Cory Mills', fec_candidate_id: 'H2FL07094' },
    ];

    await attachFecTotals(candidates, { cycle: 2026, office: 'H' });

    expect(candidates[0].fec_totals).toMatchObject({ coverage_end_date: '2026-07-29' });
    // Top-level copy is what seed_candidates.ts persists to
    // candidates.fec_coverage_end_date (migration 014).
    expect(candidates[0].fec_coverage_end_date).toBe('2026-07-29');
  });

  it('passes election_full-style Senate params through unchanged (office is forwarded, not re-derived)', async () => {
    mockedGetCandidateTotals.mockResolvedValueOnce(totals({ cycle: 2026 }));
    const candidates: MoneyCandidate[] = [
      { name: 'Ashley Moody', fec_candidate_id: 'S6FL00312' },
    ];

    await attachFecTotals(candidates, { cycle: 2026, office: 'S' });

    expect(mockedGetCandidateTotals).toHaveBeenCalledWith('S6FL00312', {
      cycle: 2026,
      office: 'S',
    });
  });

  describe('no-fallback behavior: no 2026 rows', () => {
    it('emits { no2026Filings: true } instead of falling back to another cycle', async () => {
      mockedGetCandidateTotals.mockResolvedValueOnce(null);
      const candidates: MoneyCandidate[] = [
        { name: 'New Challenger', fec_candidate_id: 'H6FL13999' },
      ];

      await attachFecTotals(candidates, { cycle: 2026, office: 'H' });

      // Exactly one call — never a second attempt at a different cycle.
      expect(mockedGetCandidateTotals).toHaveBeenCalledTimes(1);
      expect(mockedGetCandidateTotals).toHaveBeenCalledWith('H6FL13999', {
        cycle: 2026,
        office: 'H',
      });
      expect(candidates[0].fec_totals).toEqual({ no2026Filings: true });
    });

    it('clears a stale total_raised from a previous run rather than leaving it in place', async () => {
      mockedGetCandidateTotals.mockResolvedValueOnce(null);
      const candidates: MoneyCandidate[] = [
        {
          name: 'Rick Scott',
          fec_candidate_id: 'S6FL00445',
          // Simulates prior-cycle money left over from an earlier run
          // (DATA-AUDIT-2026-08-06: Scott's trailing $1.46M booked as
          // 2026 fundraising).
          total_raised: 1460000,
          fec_coverage_end_date: '2024-12-31',
          fec_totals: { committee_id: 'C0OLD', cycle: 2024 } as never,
        },
      ];

      await attachFecTotals(candidates, { cycle: 2026, office: 'S' });

      expect(candidates[0].total_raised).toBeUndefined();
      expect(candidates[0].fec_coverage_end_date).toBeUndefined();
      expect(candidates[0].fec_totals).toEqual({ no2026Filings: true });
    });
  });

  describe('candidate_id-only: no name-based search or attachment', () => {
    it('skips a candidate with no fec_candidate_id and never calls getCandidateTotals for it', async () => {
      const candidates: MoneyCandidate[] = [
        { name: 'Some Write-In Candidate' }, // no fec_candidate_id
      ];

      await attachFecTotals(candidates, { cycle: 2026, office: 'H' });

      expect(mockedGetCandidateTotals).not.toHaveBeenCalled();
      expect(candidates[0].fec_totals).toBeUndefined();
      expect(candidates[0].total_raised).toBeUndefined();
    });

    it('clears stale money on the skip path too (an entity correction can remove an id)', async () => {
      const candidates: MoneyCandidate[] = [
        {
          name: 'Lost His Id',
          // No fec_candidate_id, but money stamped by a prior run under a
          // since-corrected id — must not survive as if current.
          total_raised: 250000,
          fec_coverage_end_date: '2026-03-31',
        },
      ];

      await attachFecTotals(candidates, { cycle: 2026, office: 'H' });

      expect(mockedGetCandidateTotals).not.toHaveBeenCalled();
      expect(candidates[0].total_raised).toBeUndefined();
      expect(candidates[0].fec_coverage_end_date).toBeUndefined();
    });

    it('only fetches candidates that already carry an ID; others are skipped independently', async () => {
      mockedGetCandidateTotals.mockResolvedValueOnce(totals());
      const candidates: MoneyCandidate[] = [
        { name: 'Has An Id', fec_candidate_id: 'H6FL09001' },
        { name: 'No Id Yet' },
      ];

      await attachFecTotals(candidates, { cycle: 2026, office: 'H' });

      expect(mockedGetCandidateTotals).toHaveBeenCalledTimes(1);
      expect(mockedGetCandidateTotals).toHaveBeenCalledWith('H6FL09001', {
        cycle: 2026,
        office: 'H',
      });
      expect(candidates[0].total_raised).toBe(100000);
      expect(candidates[1].total_raised).toBeUndefined();
    });
  });
});
