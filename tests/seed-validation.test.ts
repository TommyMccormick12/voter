// Tests for the pure child-row validators + freshness re-check
// (scripts/seed/seed-validation.ts). T12 (2026-08-06, SPEC-2026-08-06.md
// §B4, TICKETS-2026-08-06.md T12).
//
// No DB, no fs — these mirror the NOT NULL / CHECK constraints declared
// in supabase/migrations/004_primary_pivot.sql for candidate_donors,
// candidate_top_industries, candidate_voting_record, candidate_statements.

import { describe, it, expect } from 'vitest';
import {
  validateDonorRow,
  validateIndustryRow,
  validateVoteRow,
  validateStatementRow,
  validateAllChildRows,
  isVerifiedFresh,
  VERIFICATION_FRESHNESS_DAYS,
} from '../scripts/seed/seed-validation';

describe('validateDonorRow (candidate_donors: donor_name, cycle NOT NULL)', () => {
  it('passes a well-formed row', () => {
    const result = validateDonorRow({ donor_name: 'Jane Smith', cycle: 2026, amount_total: 1000 }, 0);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails when donor_name is missing', () => {
    const result = validateDonorRow({ cycle: 2026 }, 0);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/donor_name is required/);
  });

  it('fails when donor_name is an empty/whitespace string', () => {
    expect(validateDonorRow({ donor_name: '   ', cycle: 2026 }, 0).ok).toBe(false);
  });

  it('fails when cycle is missing or not a number', () => {
    expect(validateDonorRow({ donor_name: 'Jane Smith' }, 0).ok).toBe(false);
    expect(validateDonorRow({ donor_name: 'Jane Smith', cycle: '2026' }, 0).ok).toBe(false);
  });

  it('reports both errors when both required fields are missing', () => {
    const result = validateDonorRow({}, 3);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain('donors[3]');
  });
});

describe('validateIndustryRow (candidate_top_industries: industry_name, cycle NOT NULL)', () => {
  it('passes a well-formed row', () => {
    expect(validateIndustryRow({ industry_name: 'Legal', cycle: 2026 }, 0).ok).toBe(true);
  });

  it('fails when industry_name is missing', () => {
    expect(validateIndustryRow({ cycle: 2026 }, 0).ok).toBe(false);
  });

  it('fails when cycle is missing', () => {
    expect(validateIndustryRow({ industry_name: 'Legal' }, 0).ok).toBe(false);
  });
});

describe('validateVoteRow (candidate_voting_record: bill_id, bill_title, vote, vote_date NOT NULL; vote CHECK)', () => {
  const goodRow = {
    bill_id: 'hr1234-119',
    bill_title: 'H.R. 1234: Some Act',
    vote: 'yea',
    vote_date: '2026-04-30',
  };

  it('passes a well-formed row', () => {
    expect(validateVoteRow(goodRow, 0).ok).toBe(true);
  });

  it('fails when bill_id is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure-to-omit
    const { bill_id, ...rest } = goodRow;
    expect(validateVoteRow(rest, 0).ok).toBe(false);
  });

  it('fails when bill_title is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure-to-omit
    const { bill_title, ...rest } = goodRow;
    expect(validateVoteRow(rest, 0).ok).toBe(false);
  });

  it('fails when vote_date is missing or unparseable', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure-to-omit
    const { vote_date, ...rest } = goodRow;
    expect(validateVoteRow(rest, 0).ok).toBe(false);
    expect(validateVoteRow({ ...goodRow, vote_date: 'not-a-date' }, 0).ok).toBe(false);
  });

  it('rejects a vote value outside the CHECK constraint (the vote-undefined class from DATA-AUDIT)', () => {
    expect(validateVoteRow({ ...goodRow, vote: 'undefined' }, 0).ok).toBe(false);
    expect(validateVoteRow({ ...goodRow, vote: 'UNDEFINED' }, 0).ok).toBe(false);
  });

  it('accepts every CHECK-allowed vote value', () => {
    for (const v of ['yea', 'nay', 'present', 'absent', 'no_vote']) {
      expect(validateVoteRow({ ...goodRow, vote: v }, 0).ok).toBe(true);
    }
  });
});

describe('validateStatementRow (candidate_statements: statement_text NOT NULL)', () => {
  it('passes a well-formed row', () => {
    expect(validateStatementRow({ statement_text: 'I support X.' }, 0).ok).toBe(true);
  });

  it('fails when statement_text is missing', () => {
    expect(validateStatementRow({}, 0).ok).toBe(false);
  });

  it('fails when statement_text is empty', () => {
    expect(validateStatementRow({ statement_text: '' }, 0).ok).toBe(false);
  });
});

describe('validateAllChildRows', () => {
  it('passes when all four row sets are empty', () => {
    const result = validateAllChildRows({ donors: [], industries: [], votes: [], statements: [] });
    expect(result.ok).toBe(true);
  });

  it('passes when all rows across all four sets are valid', () => {
    const result = validateAllChildRows({
      donors: [{ donor_name: 'A', cycle: 2026 }],
      industries: [{ industry_name: 'Legal', cycle: 2026 }],
      votes: [{ bill_id: 'hr1-119', bill_title: 'HR1', vote: 'yea', vote_date: '2026-01-01' }],
      statements: [{ statement_text: 'hello' }],
    });
    expect(result.ok).toBe(true);
  });

  it('aggregates errors across all four row types, not just the first bad one', () => {
    const result = validateAllChildRows({
      donors: [{ cycle: 2026 }], // missing donor_name
      industries: [{ industry_name: 'Legal' }], // missing cycle
      votes: [{ bill_id: 'hr1-119', bill_title: 'HR1', vote: 'bogus', vote_date: '2026-01-01' }], // bad vote
      statements: [{}], // missing statement_text
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(4);
  });

  it('a single bad row anywhere fails the whole candidate (no partial pass)', () => {
    const result = validateAllChildRows({
      donors: [{ donor_name: 'A', cycle: 2026 }, { donor_name: '', cycle: 2026 }],
      industries: [],
      votes: [],
      statements: [],
    });
    expect(result.ok).toBe(false);
  });
});

describe('seed-validation re-exports the activation-gate freshness twin', () => {
  it('VERIFICATION_FRESHNESS_DAYS is the same 14-day constant', () => {
    expect(VERIFICATION_FRESHNESS_DAYS).toBe(14);
  });

  it('isVerifiedFresh behaves identically to the activation-gate version', () => {
    const now = new Date('2026-08-06T00:00:00Z');
    expect(isVerifiedFresh(now.toISOString(), now)).toBe(true);
    expect(isVerifiedFresh(undefined, now)).toBe(false);
    const stale = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
    expect(isVerifiedFresh(stale.toISOString(), now)).toBe(false);
  });
});
