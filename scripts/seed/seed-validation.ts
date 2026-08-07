// Pure, DB-free validation for the child rows scripts/seed/seed_candidates.ts
// inserts, plus the seed-time freshness re-check.
//
// T12 (2026-08-06, SPEC-2026-08-06.md §B4): validate everything insertable
// BEFORE any delete/insert so seed_candidates.ts can refuse a candidate's
// seed atomically instead of leaving delete-then-failed-insert children
// behind (DATA-AUDIT-2026-08-06 root cause 3 #6). See the mechanism
// comment at the top of scripts/seed/seed_candidates.ts for the full
// two-layer design (this file is layer 1: proactive pre-flight checks).
//
// The constraints mirrored here come straight from the child-table DDL
// in supabase/migrations/004_primary_pivot.sql — NOT NULL / CHECK columns
// only. Anything nullable in the schema is intentionally left unchecked.

export interface RowValidation {
  ok: boolean;
  errors: string[];
}

function combine(results: RowValidation[]): RowValidation {
  const errors = results.flatMap((r) => r.errors);
  return { ok: errors.length === 0, errors };
}

// ---- candidate_donors: donor_name text NOT NULL, cycle smallint NOT NULL ----
export function validateDonorRow(
  row: Record<string, unknown>,
  index: number
): RowValidation {
  const errors: string[] = [];
  if (typeof row.donor_name !== 'string' || row.donor_name.trim() === '') {
    errors.push(`donors[${index}].donor_name is required (NOT NULL)`);
  }
  if (typeof row.cycle !== 'number' || Number.isNaN(row.cycle)) {
    errors.push(`donors[${index}].cycle is required (NOT NULL)`);
  }
  return { ok: errors.length === 0, errors };
}

// ---- candidate_top_industries: industry_name varchar NOT NULL, cycle smallint NOT NULL ----
export function validateIndustryRow(
  row: Record<string, unknown>,
  index: number
): RowValidation {
  const errors: string[] = [];
  if (typeof row.industry_name !== 'string' || row.industry_name.trim() === '') {
    errors.push(`top_industries[${index}].industry_name is required (NOT NULL)`);
  }
  if (typeof row.cycle !== 'number' || Number.isNaN(row.cycle)) {
    errors.push(`top_industries[${index}].cycle is required (NOT NULL)`);
  }
  return { ok: errors.length === 0, errors };
}

const VALID_VOTE_VALUES = new Set(['yea', 'nay', 'present', 'absent', 'no_vote']);

// ---- candidate_voting_record: bill_id/bill_title/vote_date NOT NULL, vote NOT NULL + CHECK ----
export function validateVoteRow(
  row: Record<string, unknown>,
  index: number
): RowValidation {
  const errors: string[] = [];
  if (typeof row.bill_id !== 'string' || row.bill_id.trim() === '') {
    errors.push(`voting_record[${index}].bill_id is required (NOT NULL)`);
  }
  if (typeof row.bill_title !== 'string' || row.bill_title.trim() === '') {
    errors.push(`voting_record[${index}].bill_title is required (NOT NULL)`);
  }
  if (typeof row.vote !== 'string' || !VALID_VOTE_VALUES.has(row.vote)) {
    errors.push(
      `voting_record[${index}].vote must be one of ${[...VALID_VOTE_VALUES].join(', ')} (CHECK constraint)`
    );
  }
  if (
    typeof row.vote_date !== 'string' ||
    row.vote_date.trim() === '' ||
    Number.isNaN(Date.parse(row.vote_date))
  ) {
    errors.push(`voting_record[${index}].vote_date is required and must be a valid date (NOT NULL)`);
  }
  return { ok: errors.length === 0, errors };
}

// ---- candidate_statements: statement_text text NOT NULL ----
export function validateStatementRow(
  row: Record<string, unknown>,
  index: number
): RowValidation {
  const errors: string[] = [];
  if (typeof row.statement_text !== 'string' || row.statement_text.trim() === '') {
    errors.push(`statements[${index}].statement_text is required (NOT NULL)`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateDonorRows(rows: Array<Record<string, unknown>>): RowValidation {
  return combine(rows.map(validateDonorRow));
}
export function validateIndustryRows(rows: Array<Record<string, unknown>>): RowValidation {
  return combine(rows.map(validateIndustryRow));
}
export function validateVoteRows(rows: Array<Record<string, unknown>>): RowValidation {
  return combine(rows.map(validateVoteRow));
}
export function validateStatementRows(rows: Array<Record<string, unknown>>): RowValidation {
  return combine(rows.map(validateStatementRow));
}

/** Validate all four child-row sets for one candidate in a single call. */
export function validateAllChildRows(children: {
  donors: Array<Record<string, unknown>>;
  industries: Array<Record<string, unknown>>;
  votes: Array<Record<string, unknown>>;
  statements: Array<Record<string, unknown>>;
}): RowValidation {
  return combine([
    validateDonorRows(children.donors),
    validateIndustryRows(children.industries),
    validateVoteRows(children.votes),
    validateStatementRows(children.statements),
  ]);
}

// ---- verified_at freshness re-check at seed time (T12 item 4) ----
//
// Twin of scripts/review/activation-gate.ts's VERIFICATION_FRESHNESS_DAYS
// / isVerifiedFresh — imported directly here (not re-implemented) so the
// two enforcement points can never drift apart. activate_candidate.ts
// stamps verified_at at review time; this re-export is the SECOND, later
// gate that actually keeps a stale-verified row out of production, because
// a reviewed fixture can sit unseeded for days or weeks before someone
// runs seed_candidates.ts. See the mechanism comment in seed_candidates.ts.
export { VERIFICATION_FRESHNESS_DAYS, isVerifiedFresh } from '../review/activation-gate';
