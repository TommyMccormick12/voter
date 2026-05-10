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

export async function getCandidateTotals(
  candidateId: string,
  cycle: number
): Promise<FecCommitteeTotals | null> {
  const key = requireEnv('FEC_API_KEY');
  const url = `${BASE}/candidate/${candidateId}/totals/?api_key=${key}&cycle=${cycle}&per_page=1`;
  const data = await fetchCached<{ results?: Array<Record<string, unknown>> }>(url, {
    cacheTag: `totals:${candidateId}:${cycle}`,
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
  };
}
