// FEC.gov OpenAPI client — committee details, raw filings, contribution
// totals. Used as backup/cross-check for OpenSecrets numbers.
//
// Docs: https://api.open.fec.gov/developers/
// Auth: API key — register at https://api.data.gov/signup/
// Rate limit: 1000 requests/hour
//
// Env: FEC_API_KEY

import { fetchCached, requireEnv } from './base';

const BASE = 'https://api.open.fec.gov/v1';

export interface FecCandidate {
  candidate_id: string;
  name: string;
  party: string;
  party_full: string;
  office: string;
  office_full: string;
  state: string;
  district: string | null;
  cycles: number[];
  incumbent_challenge: string;
  incumbent_challenge_full: string;
  active_through: number;
}

export interface FecCommitteeTotals {
  committee_id: string;
  cycle: number;
  receipts: number;
  disbursements: number;
  cash_on_hand_end_period: number;
  individual_contributions: number;
  other_political_committee_contributions: number;
  /** Last date FEC's filings cover for this total, e.g. "2026-06-30".
   * Render this next to every dollar figure (spec B3) — a total without
   * its coverage window reads as more current than it is. Null only when
   * FEC omits the field on the response row. */
  coverage_end_date: string | null;
}

/** T11: totals are always pinned to one cycle, joined by candidate_id only.
 * Never omit cycle/election_year; never retry with a different cycle if
 * a candidate has no rows — that's how prior-cycle money leaked into 2026
 * figures (DATA-AUDIT-2026-08-06 root cause 2). Senate races aggregate
 * across the full 6-year cycle via election_full + election_year; House
 * and President use the 2-year cycle directly. */
export interface FecTotalsParams {
  cycle: number;
  office: 'H' | 'S' | 'P';
}

export async function searchCandidates(params: {
  state?: string;
  district?: string;
  office?: 'H' | 'S' | 'P';
  cycle?: number;
  q?: string;
}): Promise<FecCandidate[]> {
  const key = requireEnv('FEC_API_KEY');
  const qs = new URLSearchParams({ api_key: key, per_page: '100' });
  if (params.state) qs.set('state', params.state);
  if (params.district) qs.set('district', params.district);
  if (params.office) qs.set('office', params.office);
  if (params.cycle) qs.set('cycle', String(params.cycle));
  if (params.q) qs.set('q', params.q);

  const url = `${BASE}/candidates/search/?${qs.toString()}`;
  const data = await fetchCached<{ results?: FecCandidate[] }>(url, {
    cacheTag: `candsearch:${qs.toString()}`,
  });
  return data.results ?? [];
}

/**
 * Principal campaign committee(s) linked to a candidate. Most federal
 * candidates have one principal committee per cycle; some have additional
 * authorized committees (rare for House/Senate, more common for President).
 */
export interface FecCommitteeLink {
  committee_id: string;
  name: string;
  designation: string;          // 'P' principal, 'A' authorized, 'J' joint fundraising
  designation_full: string;
  committee_type: string;
  cycles: number[];
}

export async function getCommitteesForCandidate(
  candidateId: string,
  cycle: number,
): Promise<FecCommitteeLink[]> {
  const key = requireEnv('FEC_API_KEY');
  const url = `${BASE}/candidate/${candidateId}/committees/?api_key=${key}&cycle=${cycle}&per_page=20`;
  const data = await fetchCached<{ results?: FecCommitteeLink[] }>(url, {
    cacheTag: `committees:${candidateId}:${cycle}`,
  });
  return data.results ?? [];
}

/**
 * Itemized individual contribution row from FEC Schedule A.
 * Only contributions >$200 are itemized by law; smaller donations are
 * aggregated in committee totals (see getCandidateTotals).
 */
export interface FecContribution {
  contributor_name: string;
  contributor_employer: string | null;
  contributor_occupation: string | null;
  contributor_state: string | null;
  contributor_city: string | null;
  contribution_receipt_amount: number;
  contribution_receipt_date: string;
  committee: { committee_id?: string; name?: string };
  entity_type: string;           // 'IND' individual, 'PAC' political action committee, 'ORG' organization
  entity_type_desc: string;
}

/**
 * Fetch itemized contributions for a committee, sorted by amount desc.
 * Used to build the top-contributor list for industry classification.
 *
 * Notes:
 *   - `two_year_transaction_period` is FEC's preferred filter (cycle end year).
 *   - Default page size 100; bump higher only if you want deeper coverage.
 *   - Each call is one API request — for Tier 1 FL with ~50 candidates,
 *     this is ~50 calls, well within the 1000/hour limit.
 */
export async function getItemizedContributions(
  committeeId: string,
  cycle: number,
  limit = 100,
): Promise<FecContribution[]> {
  const key = requireEnv('FEC_API_KEY');
  const qs = new URLSearchParams({
    api_key: key,
    committee_id: committeeId,
    two_year_transaction_period: String(cycle),
    per_page: String(Math.min(limit, 100)),
    sort: '-contribution_receipt_amount',
    is_individual: 'true',
  });
  const url = `${BASE}/schedules/schedule_a/?${qs.toString()}`;
  const data = await fetchCached<{ results?: FecContribution[] }>(url, {
    cacheTag: `sched_a:${committeeId}:${cycle}:${limit}`,
  });
  return data.results ?? [];
}

/**
 * Fetch a candidate's FEC totals for exactly one cycle, joined by
 * candidate_id only — never by name (T11 / spec B1.4, B3).
 *
 * Returns null when FEC has no rows for that cycle/office combination.
 * That is a legitimate outcome ("no filings yet") and callers MUST NOT
 * retry with a different cycle to paper over it — surface it explicitly
 * (e.g. `{ no2026Filings: true }`) instead of silently keeping whatever
 * total a previous run happened to store.
 */
/**
 * Normalize the totals endpoint's coverage_end_date to a calendar date, and
 * DROP it when it lies in the future.
 *
 * Why the future check: `/candidate/{id}/totals` reports the maximum
 * coverage_end_date across the candidate's filings, including reporting
 * periods that have not closed yet. Dan Bilzerian (H6FL06415) is the worked
 * example — his committee filed an empty October Quarterly (receipts 0,
 * coverage through 2026-09-30) alongside two real reports, so on 2026-08-07
 * the endpoint advertised his genuine $1,241,449.83 as "through 2026-09-30",
 * a date that had not happened. Rendering that next to a dollar figure tells
 * a voter the money is fresher than any filed report supports.
 *
 * Dropping to null is deliberate rather than clamping to today: the true
 * value is the latest closed period WITH activity, which this endpoint does
 * not expose (it needs /committee/{id}/filings). A missing coverage date
 * renders as no claim at all, which is honest; an invented one is not.
 *
 * `now` is an explicit parameter so tests control the clock.
 */
export function normalizeCoverageEndDate(
  raw: unknown,
  now: Date = new Date()
): string | null {
  if (typeof raw !== 'string' || raw.length < 10) return null;
  const date = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const today = now.toISOString().slice(0, 10);
  if (date > today) {
    console.warn(
      `[fec] coverage_end_date ${date} is in the future (today ${today}) — dropping it. ` +
        `The totals endpoint reports the max coverage across filings, including periods ` +
        `that have not closed; the real value is the latest CLOSED period with activity.`
    );
    return null;
  }
  return date;
}

export async function getCandidateTotals(
  candidateId: string,
  { cycle, office }: FecTotalsParams,
  now: Date = new Date()
): Promise<FecCommitteeTotals | null> {
  const key = requireEnv('FEC_API_KEY');
  const qs = new URLSearchParams({ api_key: key, per_page: '1' });
  if (office === 'S') {
    // Senate: 6-year cycle aggregation. cycle is intentionally omitted —
    // election_full + election_year is the pair FEC expects together.
    qs.set('election_full', 'true');
    qs.set('election_year', String(cycle));
  } else {
    qs.set('cycle', String(cycle));
  }
  const url = `${BASE}/candidate/${candidateId}/totals/?${qs.toString()}`;
  const data = await fetchCached<{ results?: Array<Record<string, unknown>> }>(url, {
    cacheTag: `totals:${candidateId}:${cycle}:${office}`,
  });
  const r = data.results?.[0];
  if (!r) return null;
  return {
    committee_id: String(r.committee_id ?? ''),
    cycle: Number(r.cycle ?? cycle),
    receipts: Number(r.receipts ?? 0),
    disbursements: Number(r.disbursements ?? 0),
    cash_on_hand_end_period: Number(r.cash_on_hand_end_period ?? 0),
    individual_contributions: Number(r.individual_contributions ?? 0),
    other_political_committee_contributions: Number(
      r.other_political_committee_contributions ?? 0
    ),
    // openFEC returns a full ISO timestamp ("2026-06-30T00:00:00+00:00");
    // normalize to the calendar date so downstream consumers (fixtures,
    // candidates.fec_coverage_end_date, parseLocalDate in src/lib/dates.ts)
    // never see a timestamp that would shift a day under UTC parsing.
    // A future date is dropped — see normalizeCoverageEndDate.
    coverage_end_date: normalizeCoverageEndDate(r.coverage_end_date, now),
  };
}
