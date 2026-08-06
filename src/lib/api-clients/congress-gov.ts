// Congress.gov official API client — House roll-call votes, bioguide-keyed.
//
// Replaces the GovTrack scrape path (govtrack.ts, deleted — its public
// bulk data/API ended 2016-17 per DATA-SOURCES-2026-08-06.md §4; the
// scrape was always unsupported).
//
// Docs: https://api.congress.gov/
//       https://github.com/LibraryOfCongress/api.congress.gov/blob/main/Documentation/HouseRollCallVoteEndpoint.md
//       https://github.com/LibraryOfCongress/api.congress.gov/blob/main/Documentation/BillEndpoint.md
// Auth: API key (free) — https://api.congress.gov/sign-up/
// Rate limit: 5,000 req/hr.
// Coverage: House roll-call votes cover the 118th Congress forward
//   (beta). No per-member "give me all their votes" endpoint exists — you
//   enumerate a session's votes, then read each vote's member list. That
//   shape drives getMemberHouseVotes below.
//
// Env: CONGRESS_GOV_API_KEY. requireEnv() throws a clear, actionable error
// when it's unset — every exported function that hits the network calls it
// first, so a missing key fails loudly on first use, never silently.

import { fetchCached, requireEnv } from './base';

const BASE = 'https://api.congress.gov/v3';

/** The Congress currently in session. Update this pair when a new Congress
 * convenes (every two years, odd-numbered year = session 1). */
export const CURRENT_CONGRESS = 119;
export const CURRENT_SESSION: 1 | 2 = 2; // 2026 is the second session of the 119th Congress.

function apiKey(): string {
  return requireEnv('CONGRESS_GOV_API_KEY');
}

// ============================================================
// Types — the slice of the Congress.gov response we read
// ============================================================

export interface HouseVoteListItem {
  congress: number;
  sessionNumber: number;
  rollCallNumber: number;
  startDate: string;
  legislationType?: string;
  legislationNumber?: string;
  voteQuestion?: string;
  result?: string;
}

export interface HouseVoteMemberRow {
  bioguideId: string;
  voteCast: string; // "Aye" | "Nay" | "Present" | "Not Voting"
  firstName?: string;
  lastName?: string;
  voteParty?: string;
  voteState?: string;
}

export interface HouseVoteDetail {
  congress: number;
  sessionNumber: number;
  rollCallNumber: number;
  startDate: string;
  legislationType?: string;
  legislationNumber?: string;
  amendmentType?: string;
  amendmentNumber?: string;
  voteQuestion?: string;
  result?: string;
  members: HouseVoteMemberRow[];
}

export interface BillDetail {
  title: string | null;
  latestActionText: string | null;
  latestActionDate: string | null;
}

// ============================================================
// Raw endpoints
// ============================================================

export async function listHouseVotes(
  congress: number,
  session: 1 | 2,
): Promise<HouseVoteListItem[]> {
  const key = apiKey();
  const url = `${BASE}/house-vote/${congress}/${session}?api_key=${key}&format=json&limit=250`;
  const data = await fetchCached<{ houseRollCallVotes?: HouseVoteListItem[] }>(url, {
    cacheTag: `congressgov:house-vote-list:${congress}:${session}`,
  });
  return data.houseRollCallVotes ?? [];
}

interface RawMemberVotesResponse {
  houseRollCallVoteMemberVotes?: {
    congress: number;
    sessionNumber: number;
    rollCallNumber: number;
    startDate: string;
    legislationType?: string;
    legislationNumber?: string;
    amendmentType?: string;
    amendmentNumber?: string;
    voteQuestion?: string;
    result?: string;
    results?: HouseVoteMemberRow[];
  };
}

export async function getHouseVoteMembers(
  congress: number,
  session: 1 | 2,
  rollCallNumber: number,
): Promise<HouseVoteDetail | null> {
  const key = apiKey();
  const url = `${BASE}/house-vote/${congress}/${session}/${rollCallNumber}/members?api_key=${key}&format=json&limit=450`;
  const data = await fetchCached<RawMemberVotesResponse>(url, {
    cacheTag: `congressgov:house-vote-members:${congress}:${session}:${rollCallNumber}`,
  });
  const detail = data.houseRollCallVoteMemberVotes;
  if (!detail) return null;
  return {
    congress: detail.congress,
    sessionNumber: detail.sessionNumber,
    rollCallNumber: detail.rollCallNumber,
    startDate: detail.startDate,
    legislationType: detail.legislationType,
    legislationNumber: detail.legislationNumber,
    amendmentType: detail.amendmentType,
    amendmentNumber: detail.amendmentNumber,
    voteQuestion: detail.voteQuestion,
    result: detail.result,
    members: detail.results ?? [],
  };
}

/**
 * Bill title + latest action, used to enrich a vote's bill_title beyond the
 * bare "On Motion to Suspend the Rules and Pass" vote question (fixes the
 * "truncated bill titles" item in spec B1 tail). billType must be the
 * lowercase Congress.gov path segment ("hr", "hjres", "hconres", "hres").
 * Returns null on any miss (unknown bill, network hiccup after retries are
 * exhausted by fetchCached's own throw) rather than throwing — a missing
 * enrichment falls back to the vote question, which is still truthful.
 */
export async function getBillDetail(
  congress: number,
  billType: string,
  billNumber: string,
): Promise<BillDetail | null> {
  const key = apiKey();
  const url = `${BASE}/bill/${congress}/${billType.toLowerCase()}/${billNumber}?api_key=${key}&format=json`;
  try {
    const data = await fetchCached<{
      bill?: { title?: string; latestAction?: { text?: string; actionDate?: string } };
    }>(url, { cacheTag: `congressgov:bill:${congress}:${billType}:${billNumber}` });
    const bill = data.bill;
    if (!bill) return null;
    return {
      title: bill.title ?? null,
      latestActionText: bill.latestAction?.text ?? null,
      latestActionDate: bill.latestAction?.actionDate ?? null,
    };
  } catch {
    return null;
  }
}

// ============================================================
// Shape helpers
// ============================================================

export function normalizeVoteCast(cast: string): 'yea' | 'nay' | 'present' | 'absent' | 'no_vote' {
  const map: Record<string, 'yea' | 'nay' | 'present' | 'absent'> = {
    Aye: 'yea',
    Yea: 'yea',
    Yes: 'yea',
    Nay: 'nay',
    No: 'nay',
    Present: 'present',
    'Not Voting': 'absent',
  };
  return map[cast] ?? 'no_vote';
}

/**
 * Stable bill_id in the "{type}{number}-{congress}" format the rest of the
 * pipeline (synthesis citation validation) expects, e.g. "hr1234-119".
 * Returns null when the vote has no attached bill (procedural motions,
 * some amendment-only votes) — callers must supply their own non-undefined
 * fallback rather than let this leak into the fixture as "vote-undefined"
 * (DATA-AUDIT-2026-08-06 finding: 20 Senate entries had exactly that bug).
 */
export function billIdFromHouseVote(v: {
  legislationType?: string;
  legislationNumber?: string;
  amendmentType?: string;
  amendmentNumber?: string;
  congress: number;
}): string | null {
  if (v.legislationType && v.legislationNumber) {
    return `${v.legislationType.toLowerCase()}${v.legislationNumber}-${v.congress}`;
  }
  if (v.amendmentType && v.amendmentNumber) {
    return `${v.amendmentType.toLowerCase()}${v.amendmentNumber}-${v.congress}`;
  }
  return null;
}

const BILL_TYPE_URL_SEGMENT: Record<string, string> = {
  hr: 'house-bill',
  hjres: 'house-joint-resolution',
  hconres: 'house-concurrent-resolution',
  hres: 'house-resolution',
  s: 'senate-bill',
  sjres: 'senate-joint-resolution',
  sconres: 'senate-concurrent-resolution',
  sres: 'senate-resolution',
};

/** Human-facing congress.gov URL for a bill, or null when the vote has no
 * attached legislation. */
export function billUrlFromHouseVote(v: {
  legislationType?: string;
  legislationNumber?: string;
  congress: number;
}): string | null {
  if (!v.legislationType || !v.legislationNumber) return null;
  const segment = BILL_TYPE_URL_SEGMENT[v.legislationType.toLowerCase()];
  if (!segment) return null;
  return `https://www.congress.gov/bill/${v.congress}th-congress/${segment}/${v.legislationNumber}`;
}

// ============================================================
// Member vote history — enumerate the session's votes, filter to one bioguide
// ============================================================

export interface MemberHouseVote {
  vote: HouseVoteDetail;
  position: HouseVoteMemberRow;
}

/**
 * All recorded House votes cast by `bioguideId` across the given
 * congress/sessions (newest first, capped at `limit`). There is no
 * per-member endpoint on Congress.gov's House vote API — every vote in the
 * session is enumerated and its member roster is checked for this bioguide.
 * Every member-roster request is disk-cached (fetchCached), so this is only
 * ever expensive once per vote, shared across every candidate the ingest
 * script processes in the same run.
 */
export async function getMemberHouseVotes(
  bioguideId: string,
  congress: number = CURRENT_CONGRESS,
  sessions: Array<1 | 2> = [2, 1],
  limit = 50,
): Promise<MemberHouseVote[]> {
  const out: MemberHouseVote[] = [];
  for (const session of sessions) {
    if (out.length >= limit) break;
    const list = await listHouseVotes(congress, session);
    const sorted = [...list].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
    for (const item of sorted) {
      if (out.length >= limit) break;
      const detail = await getHouseVoteMembers(congress, session, item.rollCallNumber);
      if (!detail) continue;
      const row = detail.members.find((m) => m.bioguideId === bioguideId);
      if (row) out.push({ vote: detail, position: row });
    }
  }
  return out;
}
