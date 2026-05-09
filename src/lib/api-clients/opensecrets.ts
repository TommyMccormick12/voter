// OpenSecrets API client — top contributors + top industries + cycle totals
// for federal candidates.
//
// Docs: https://www.opensecrets.org/api/
// Auth: free API key from https://www.opensecrets.org/api/admin/index.php
// Rate limit: 200 requests/day on the free tier (cache aggressively).
//
// Env: OPENSECRETS_API_KEY

import { fetchCached, requireEnv } from './base';

const BASE = 'https://www.opensecrets.org/api/';

export interface CandSummary {
  candidate_id: string;
  cid: string;
  cycle: number;
  total: number;
  spent: number;
  cash_on_hand: number;
  debt: number;
  origin: string;
  source: string;
  last_updated: string;
}

export interface IndustryEntry {
  industry_code: string;
  industry_name: string;
  indivs: number;
  pacs: number;
  total: number;
}

export interface ContributorEntry {
  org_name: string;
  total: number;
  pacs: number;
  indivs: number;
}

/**
 * Look up an OpenSecrets CRP candidate ID (CID) by name. Required input
 * to most other endpoints.
 *
 * @param year four-digit cycle, e.g. 2026
 * @param state two-letter abbreviation
 */
export async function getCandidatesByState(
  year: number,
  state: string
): Promise<Array<{ cid: string; firstlast: string; party: string; office: string }>> {
  const key = requireEnv('OPENSECRETS_API_KEY');
  const url = `${BASE}?method=getLegislators&id=${state}&apikey=${key}&output=json`;
  const data = await fetchCached<{ response?: { legislator?: Array<{ '@attributes': Record<string, string> }> } }>(url, {
    cacheTag: `legislators:${state}:${year}`,
  });
  const list = data.response?.legislator ?? [];
  return list.map((entry) => ({
    cid: entry['@attributes'].cid,
    firstlast: entry['@attributes'].firstlast,
    party: entry['@attributes'].party,
    office: 'congress',
  }));
}

export async function getCandSummary(cid: string, cycle: number): Promise<CandSummary | null> {
  const key = requireEnv('OPENSECRETS_API_KEY');
  const url = `${BASE}?method=candSummary&cid=${cid}&cycle=${cycle}&apikey=${key}&output=json`;
  const data = await fetchCached<{ response?: { summary?: { '@attributes': Record<string, string> } } }>(url, {
    cacheTag: `summary:${cid}:${cycle}`,
  });
  const attrs = data.response?.summary?.['@attributes'];
  if (!attrs) return null;
  return {
    candidate_id: attrs.cand_name ?? '',
    cid,
    cycle,
    total: parseFloat(attrs.total ?? '0'),
    spent: parseFloat(attrs.spent ?? '0'),
    cash_on_hand: parseFloat(attrs.cash_on_hand ?? '0'),
    debt: parseFloat(attrs.debt ?? '0'),
    origin: attrs.origin ?? '',
    source: attrs.source ?? '',
    last_updated: attrs.last_updated ?? '',
  };
}

export async function getCandIndustries(cid: string, cycle: number): Promise<IndustryEntry[]> {
  const key = requireEnv('OPENSECRETS_API_KEY');
  const url = `${BASE}?method=candIndustry&cid=${cid}&cycle=${cycle}&apikey=${key}&output=json`;
  const data = await fetchCached<{
    response?: { industries?: { industry?: Array<{ '@attributes': Record<string, string> }> } };
  }>(url, { cacheTag: `industries:${cid}:${cycle}` });
  const list = data.response?.industries?.industry ?? [];
  return list.map((entry) => {
    const a = entry['@attributes'];
    return {
      industry_code: a.industry_code ?? '',
      industry_name: a.industry_name ?? '',
      indivs: parseFloat(a.indivs ?? '0'),
      pacs: parseFloat(a.pacs ?? '0'),
      total: parseFloat(a.total ?? '0'),
    };
  });
}

export async function getCandContributors(cid: string, cycle: number): Promise<ContributorEntry[]> {
  const key = requireEnv('OPENSECRETS_API_KEY');
  const url = `${BASE}?method=candContrib&cid=${cid}&cycle=${cycle}&apikey=${key}&output=json`;
  const data = await fetchCached<{
    response?: { contributors?: { contributor?: Array<{ '@attributes': Record<string, string> }> } };
  }>(url, { cacheTag: `contrib:${cid}:${cycle}` });
  const list = data.response?.contributors?.contributor ?? [];
  return list.map((entry) => {
    const a = entry['@attributes'];
    return {
      org_name: a.org_name ?? '',
      total: parseFloat(a.total ?? '0'),
      pacs: parseFloat(a.pacs ?? '0'),
      indivs: parseFloat(a.indivs ?? '0'),
    };
  });
}
