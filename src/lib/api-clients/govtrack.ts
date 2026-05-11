// GovTrack API client — current members, voting records, bill details.
//
// Replaces the prior ProPublica Congress API client (sunset in 2023).
// GovTrack is keyless, actively maintained, and provides the same data
// we need: member discovery + per-member vote history + bill linkage.
//
// Docs: https://www.govtrack.us/developers/api
// Auth: none required
// Rate limit: loose, no documented hard cap (be polite — script throttles via fetchCached)
//
// Endpoint coverage:
//   /role?current=true       — bulk current-Congress members with embedded persons
//   /vote_voter?person={id}  — one member's full vote history (paginated, 4,000+ for veterans)
//   /vote/{id}               — vote detail with related_bill (title, type, status, dates)

import { fetchCached } from './base';

const BASE = 'https://www.govtrack.us/api/v2';

// ============================================================
// Types — match the slice of GovTrack we care about
// ============================================================

export interface GovTrackPerson {
  bioguideid: string; // e.g. "B001288" — Library of Congress canonical ID
  firstname: string;
  lastname: string;
  name: string;       // e.g. "Sen. Cory Booker [D-NJ]"
  link: string;       // URL with numeric ID at the end (we parse it out)
}

export interface GovTrackRole {
  person: GovTrackPerson;
  role_type: 'senator' | 'representative';
  state: string;            // ISO state code, e.g. "FL"
  district: number | null;  // null for senators
  party: string;
  current: boolean;
  enddate: string;
}

export interface GovTrackVoteRow {
  // The vote_id is nested under `option.vote` (not at top level). Fetch
  // /vote/{option.vote} for full detail including related_bill.
  option: {
    key: string;
    value: string; // "Yea" | "Nay" | "Present" | "Not Voting"
    vote: number;  // vote_id
    winner: boolean | null;
  };
  created: string;          // ISO datetime
  person: GovTrackPerson;
}

export interface GovTrackRelatedBill {
  display_number: string;   // "H.R. 1", "S. 184"
  bill_type: string;        // "house_bill", "senate_bill", "senate_joint_resolution", etc.
  number: number;
  congress: number;
  title: string;
  current_status: string;
  current_status_description: string;
  current_status_label: string;
  introduced_date: string;
  link: string;
}

export interface GovTrackVote {
  id: number;
  congress: number;
  chamber: 'house' | 'senate';
  session: string;
  number: number;
  question: string;
  category: string;         // "procedural" | "passage" | "amendment" | ...
  category_label: string;
  passed: boolean;
  created: string;
  link: string;
  related_bill: GovTrackRelatedBill | null;
}

// ============================================================
// Member discovery
// ============================================================

// Cache the full current-Congress roster across calls in the same process.
// Roster is ~538 records and rarely changes; one bulk fetch covers the script run.
let cachedRoles: GovTrackRole[] | null = null;

async function fetchAllCurrentRoles(): Promise<GovTrackRole[]> {
  if (cachedRoles) return cachedRoles;
  // limit=600 is enough to grab both chambers in a single request; 538 total today.
  const url = `${BASE}/role?current=true&limit=600`;
  const data = await fetchCached<{ objects: GovTrackRole[] }>(url, {
    cacheTag: 'govtrack:roles:current',
  });
  cachedRoles = data.objects ?? [];
  return cachedRoles;
}

/**
 * GovTrack person ID parsed from the link URL.
 * Format: "https://www.govtrack.us/congress/members/cory_booker/412598"
 */
function extractPersonId(link: string): number | null {
  const m = link.match(/\/(\d+)\/?$/);
  return m ? Number.parseInt(m[1], 10) : null;
}

export interface MemberMatch {
  govtrack_id: number;
  bioguide_id: string;
  full_name: string;
  state: string;
  district: number | null;
  chamber: 'house' | 'senate';
}

/**
 * Find a sitting member by name + state + chamber. Returns the GovTrack
 * person ID (used for vote queries) and the bioguide ID (cross-references
 * with congress.gov + FEC) on hit, or null on miss.
 *
 * Matching strategy:
 *   1. Exact full-name match (case-insensitive)
 *   2. Last-name match within the state+chamber (handles "Maxwell Frost"
 *      stored as "Frost, Maxwell Alejandro" or similar variants)
 *
 * Signature is intentionally compatible with the prior ProPublica client
 * so callers don't break — the only added field is bioguide_id.
 */
/**
 * Pure name-matching logic, exported so tests can hit it without mocking
 * fetchAllCurrentRoles. Takes a pre-filtered list of GovTrack roles
 * (already scoped to the right chamber + state) and returns the matching
 * role, or null.
 *
 * Strategy:
 *   1. Exact case-insensitive match on "firstname lastname".
 *   2. Single-word query → legacy last-name-only fallback (caller accepts
 *      the false-positive risk).
 *   3. Multi-word query → require lastname-equal AND first-name prefix
 *      match in either direction (>=3 char prefix on whichever side is
 *      shorter). Blocks the Royal-Webster-vs-Daniel-Webster false-positive.
 */
export function matchRoleByName(
  candidates: GovTrackRole[],
  fullName: string,
): GovTrackRole | null {
  const queryLower = fullName.toLowerCase().trim();
  if (!queryLower) return null;
  const queryTokens = queryLower.split(/\s+/).filter(Boolean);
  const queryLast = queryTokens[queryTokens.length - 1] ?? '';

  // Exact match on "firstname lastname"
  let hit = candidates.find((r) => {
    const combined = `${r.person.firstname} ${r.person.lastname}`.toLowerCase();
    return combined === queryLower;
  });

  if (!hit) {
    if (queryTokens.length <= 1) {
      // Single-word query → legacy last-name fallback.
      hit = candidates.find(
        (r) => r.person.lastname.toLowerCase() === queryLast,
      );
    } else {
      // Multi-word query → require last-name AND first-name match by one of:
      //   (a) GovTrack stored firstname is an initial-only ("C.", "J", "W.")
      //       — no way to compare an initial to a full name reliably, so
      //       fall back to last-name-only. Recovers cases like Scott
      //       Franklin matching against "C. Franklin" (GovTrack-side data
      //       quirk; legitimate match).
      //   (b) Bi-directional prefix match on first name (>=3 chars).
      //       Blocks Royal Webster vs Daniel Webster (no prefix overlap)
      //       while allowing Maxwell ↔ Max nickname truncation.
      const queryFirst = queryTokens[0];
      hit = candidates.find((r) => {
        if (r.person.lastname.toLowerCase() !== queryLast) return false;
        const personFirst = r.person.firstname.toLowerCase();
        if (!personFirst || !queryFirst) return false;

        // (a) Initial-only stored firstname → last-name match is sufficient.
        const isInitialOnly = personFirst.length <= 2 || personFirst.endsWith('.');
        if (isInitialOnly) return true;

        // (b) Bi-directional prefix match.
        const minPrefixLen = Math.min(personFirst.length, queryFirst.length, 3);
        return (
          personFirst.startsWith(queryFirst.slice(0, minPrefixLen)) ||
          queryFirst.startsWith(personFirst.slice(0, minPrefixLen))
        );
      });
    }
  }

  return hit ?? null;
}

export async function findMember(
  fullName: string,
  state: string,
  chamber: 'house' | 'senate',
): Promise<MemberMatch | null> {
  const roles = await fetchAllCurrentRoles();
  const targetType = chamber === 'house' ? 'representative' : 'senator';
  const stateUpper = state.toUpperCase();

  // Filter to the right chamber + state first, then match name
  const candidates = roles.filter(
    (r) => r.role_type === targetType && r.state === stateUpper,
  );

  const hit = matchRoleByName(candidates, fullName);
  if (!hit) return null;
  const govtrack_id = extractPersonId(hit.person.link);
  if (!govtrack_id) return null;

  return {
    govtrack_id,
    bioguide_id: hit.person.bioguideid,
    full_name: `${hit.person.firstname} ${hit.person.lastname}`,
    state: hit.state,
    district: hit.district,
    chamber,
  };
}

// ============================================================
// Voting record
// ============================================================

/**
 * Recent votes for a member. Returns up to `limit` votes ordered newest-first.
 * GovTrack's vote_voter endpoint returns vote rows without bill detail;
 * follow up with getVoteDetail() for each unique vote id to enrich.
 */
export async function getMemberVotes(
  govtrackId: number,
  limit = 50,
): Promise<GovTrackVoteRow[]> {
  const url = `${BASE}/vote_voter?person=${govtrackId}&limit=${limit}&order_by=-created`;
  const data = await fetchCached<{ objects: GovTrackVoteRow[] }>(url, {
    cacheTag: `govtrack:votes:${govtrackId}:${limit}`,
  });
  return data.objects ?? [];
}

/**
 * Full vote detail including related bill. Used to enrich vote rows with
 * bill_id, title, and status description for the synthesis step.
 */
export async function getVoteDetail(voteId: number): Promise<GovTrackVote | null> {
  if (!voteId) return null;
  const url = `${BASE}/vote/${voteId}`;
  try {
    const data = await fetchCached<GovTrackVote>(url, {
      cacheTag: `govtrack:vote:${voteId}`,
    });
    return data ?? null;
  } catch {
    return null;
  }
}

// ============================================================
// Shape helpers — keep the partial-fixture shape stable across the swap
// ============================================================

/**
 * Map GovTrack vote position string → the canonical labels used by
 * candidate_voting_record.vote (yea / nay / present / absent / no_vote).
 * Mirror of the prior voteLabel() in fetch_propublica_votes.ts.
 */
export function normalizeVotePosition(option: string): string {
  const map: Record<string, string> = {
    Yea: 'yea',
    Aye: 'yea',
    Yes: 'yea',
    Nay: 'nay',
    No: 'nay',
    Present: 'present',
    'Not Voting': 'absent',
    'Did Not Vote': 'absent',
  };
  return map[option] ?? 'no_vote';
}

/**
 * Construct a stable bill_id from a GovTrack related_bill. Format matches
 * what scripts/synthesize/synthesize_stances.ts expects for citation
 * validation: "{type}{number}-{congress}" e.g. "hr1-119" or "sjres184-119".
 *
 * Returns null when there's no associated bill (some procedural votes).
 */
export function billIdFromRelated(bill: GovTrackRelatedBill | null): string | null {
  if (!bill) return null;
  const typeMap: Record<string, string> = {
    house_bill: 'hr',
    senate_bill: 's',
    house_joint_resolution: 'hjres',
    senate_joint_resolution: 'sjres',
    house_concurrent_resolution: 'hconres',
    senate_concurrent_resolution: 'sconres',
    house_resolution: 'hres',
    senate_resolution: 'sres',
  };
  const prefix = typeMap[bill.bill_type] ?? bill.bill_type;
  return `${prefix}${bill.number}-${bill.congress}`;
}
