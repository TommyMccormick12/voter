// ProPublica Congress API client — bills, votes, member voting records.
//
// Docs: https://projects.propublica.org/api-docs/congress-api/
// Auth: free API key (email signup at the docs URL)
// Rate limit: 5000 requests/day
//
// Env: PROPUBLICA_API_KEY
//
// Note: ProPublica uses "member ID" (e.g. "K000395" for Tom Kean Jr.).
// Look this up via getMembersByCongress and match by name + state.

import { fetchCached, requireEnv } from './base';

const BASE = 'https://api.propublica.org/congress/v1';

export interface PropublicaMember {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  state: string;
  district: string | null;
  party: string;
  in_office: boolean;
  next_election: string;
  total_votes: number;
}

export interface MemberVote {
  member_id: string;
  chamber: 'house' | 'senate';
  congress: number;
  session: number;
  roll_call: number;
  vote_uri: string;
  bill: {
    bill_id?: string;
    number?: string;
    bill_uri?: string;
    title?: string;
    latest_action?: string;
  };
  description: string;
  question: string;
  result: string;
  date: string;
  time: string;
  total: { yes: number; no: number; present: number; not_voting: number };
  position: 'Yes' | 'No' | 'Present' | 'Not Voting';
}

const headers = (): Record<string, string> => ({
  'X-API-Key': requireEnv('PROPUBLICA_API_KEY'),
});

export async function getMembersByCongress(
  congress: number,
  chamber: 'house' | 'senate'
): Promise<PropublicaMember[]> {
  const url = `${BASE}/${congress}/${chamber}/members.json`;
  const data = await fetchCached<{
    results?: Array<{ members?: PropublicaMember[] }>;
  }>(url, { headers: headers(), cacheTag: `members:${congress}:${chamber}` });
  return data.results?.[0]?.members ?? [];
}

export async function findMemberId(
  fullName: string,
  state: string,
  chamber: 'house' | 'senate',
  congress = 119
): Promise<string | null> {
  const members = await getMembersByCongress(congress, chamber);
  const lower = fullName.toLowerCase().trim();
  const stateUpper = state.toUpperCase();
  // Try exact match on full_name first, then prefix
  let hit = members.find((m) => m.state === stateUpper && m.full_name.toLowerCase() === lower);
  if (!hit) {
    hit = members.find(
      (m) =>
        m.state === stateUpper &&
        `${m.first_name} ${m.last_name}`.toLowerCase() === lower
    );
  }
  return hit?.id ?? null;
}

/**
 * Recent votes for a member. Returns up to ~20 per call; paginate via
 * offset for more.
 */
export async function getMemberVotes(memberId: string, offset = 0): Promise<MemberVote[]> {
  const url = `${BASE}/members/${memberId}/votes.json?offset=${offset}`;
  const data = await fetchCached<{
    results?: Array<{ votes?: MemberVote[] }>;
  }>(url, { headers: headers(), cacheTag: `votes:${memberId}:${offset}` });
  return data.results?.[0]?.votes ?? [];
}

/**
 * Bill detail — used to enrich a vote with the bill's primary subject
 * and a longer summary (votes endpoint only includes title + latest_action).
 */
export async function getBill(billId: string, congress = 119): Promise<{
  short_title?: string;
  primary_subject?: string;
  summary_short?: string;
  summary?: string;
} | null> {
  if (!billId) return null;
  const url = `${BASE}/${congress}/bills/${billId}.json`;
  try {
    const data = await fetchCached<{ results?: Array<Record<string, string>> }>(url, {
      headers: headers(),
      cacheTag: `bill:${billId}:${congress}`,
    });
    return data.results?.[0] ?? null;
  } catch {
    return null;
  }
}
