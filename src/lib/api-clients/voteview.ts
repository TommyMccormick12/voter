// Voteview client — Senate roll-call votes (and House backfill), CSV exports.
//
// Congress.gov's House Roll Call Vote API has no Senate coverage yet
// (per DATA-SOURCES-2026-08-06.md §4), so Senate votes come from Voteview
// (voteview.com/data), which publishes both chambers and includes
// bioguide_id directly on the member roster — no name matching needed.
//
// Docs: https://voteview.com/data
// Auth: none (public static CSV files).
// Files used (per Congress, e.g. 119th):
//   /static/data/out/members/S{congress}_members.csv — one row per
//     member-Congress; icpsr is the join key to the votes file, bioguide_id
//     is present directly.
//   /static/data/out/votes/S{congress}_votes.csv — one row per
//     (rollnumber, icpsr): congress, chamber, rollnumber, icpsr, cast_code, prob.
//   /static/data/out/rollcalls/S{congress}_rollcalls.csv — one row per
//     rollnumber: date, bill_number, vote_result, vote_desc, vote_question.
//
// cast_code (Voteview / ICPSR convention, verified against the live 119th
// Senate export 2026-08-06): 0 = not a member, 1-3 = Yea variants
// (Yea / Paired Yea / Announced Yea), 4-6 = Nay variants, 7-8 = Present,
// 9 = Not Voting.

import { fetchCachedText } from './base';

const DATA_BASE = 'https://voteview.com/static/data/out';

// ============================================================
// Types
// ============================================================

export interface VoteviewMember {
  congress: number;
  chamber: string;
  icpsr: number;
  bioname: string;
  bioguide_id: string | null;
  state_abbrev: string;
  party_code: string;
}

export interface VoteviewVoteRow {
  congress: number;
  chamber: string;
  rollnumber: number;
  icpsr: number;
  cast_code: number;
}

export interface VoteviewRollCall {
  congress: number;
  chamber: string;
  rollnumber: number;
  date: string;
  bill_number: string | null;
  vote_result: string | null;
  vote_desc: string | null;
  vote_question: string | null;
}

// ============================================================
// Minimal RFC4180-ish CSV parser
// ============================================================
//
// Handles quoted fields (Voteview's vote_desc column embeds commas and
// occasional literal quotes), "" as an escaped quote inside a quoted
// field, and CRLF/LF line endings. Not a general CSV library — this repo
// has no CSV-parsing dependency, so ingest scripts parse manually per
// project convention (see CLAUDE.md constraint on this ticket).

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let sawAnyContent = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      sawAnyContent = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      sawAnyContent = true;
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      sawAnyContent = false;
      i++;
      continue;
    }
    field += ch;
    sawAnyContent = true;
    i++;
  }
  if (sawAnyContent || field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toRecords(rows: string[][]): Array<Record<string, string>> {
  if (rows.length === 0) return [];
  const [header, ...body] = rows;
  return body
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

// ============================================================
// Fetch + cache
// ============================================================

async function fetchCsvRecords(url: string, cacheTag: string): Promise<Array<Record<string, string>>> {
  const text = await fetchCachedText(url, { cacheTag });
  return toRecords(parseCsv(text));
}

export async function fetchSenateMembers(congress: number): Promise<VoteviewMember[]> {
  const url = `${DATA_BASE}/members/S${congress}_members.csv`;
  const records = await fetchCsvRecords(url, `voteview:members:${congress}`);
  return records
    .filter((r) => r.chamber === 'Senate')
    .map((r) => ({
      congress: Number(r.congress),
      chamber: r.chamber,
      icpsr: Number(r.icpsr),
      bioname: r.bioname,
      bioguide_id: r.bioguide_id || null,
      state_abbrev: r.state_abbrev,
      party_code: r.party_code,
    }));
}

export async function fetchSenateVotes(congress: number): Promise<VoteviewVoteRow[]> {
  const url = `${DATA_BASE}/votes/S${congress}_votes.csv`;
  const records = await fetchCsvRecords(url, `voteview:votes:${congress}`);
  return records.map((r) => ({
    congress: Number(r.congress),
    chamber: r.chamber,
    rollnumber: Number(r.rollnumber),
    icpsr: Number(r.icpsr),
    cast_code: Number(r.cast_code),
  }));
}

export async function fetchSenateRollCalls(congress: number): Promise<VoteviewRollCall[]> {
  const url = `${DATA_BASE}/rollcalls/S${congress}_rollcalls.csv`;
  const records = await fetchCsvRecords(url, `voteview:rollcalls:${congress}`);
  return records.map((r) => ({
    congress: Number(r.congress),
    chamber: r.chamber,
    rollnumber: Number(r.rollnumber),
    date: r.date,
    bill_number: r.bill_number || null,
    vote_result: r.vote_result || null,
    vote_desc: r.vote_desc || null,
    vote_question: r.vote_question || null,
  }));
}

// ============================================================
// Shape helpers
// ============================================================

export function normalizeCastCode(code: number): 'yea' | 'nay' | 'present' | 'absent' | 'no_vote' {
  if (code >= 1 && code <= 3) return 'yea';
  if (code >= 4 && code <= 6) return 'nay';
  if (code === 7 || code === 8) return 'present';
  if (code === 9) return 'absent';
  return 'no_vote';
}

/**
 * Stable bill_id in the "{type}{number}-{congress}" format the pipeline
 * expects, e.g. "s5-119", "hconres14-119". Returns null when the roll call
 * has no bill_number (procedural motions, nominations) — callers must
 * supply their own non-undefined fallback, same contract as
 * congress-gov.ts's billIdFromHouseVote.
 */
export function billIdFromRollCall(rc: { bill_number: string | null; congress: number }): string | null {
  if (!rc.bill_number) return null;
  const m = rc.bill_number.match(/^([A-Za-z]+)(\d+)$/);
  if (!m) return null;
  return `${m[1].toLowerCase()}${m[2]}-${rc.congress}`;
}

// ============================================================
// Member vote history
// ============================================================

export interface MemberSenateVote {
  rollCall: VoteviewRollCall;
  cast_code: number;
}

/**
 * All recorded Senate votes cast by `bioguideId` in the given Congress
 * (newest first, capped at `limit`). Joins the three Voteview exports by
 * icpsr (member <-> vote) and rollnumber (vote <-> roll call metadata) —
 * bioguide_id is read once, off the members file, never compared by name.
 */
export async function getMemberSenateVotes(
  bioguideId: string,
  congress: number,
  limit = 50,
): Promise<MemberSenateVote[]> {
  const [members, votes, rollCalls] = await Promise.all([
    fetchSenateMembers(congress),
    fetchSenateVotes(congress),
    fetchSenateRollCalls(congress),
  ]);
  const member = members.find((m) => m.bioguide_id === bioguideId);
  if (!member) return [];

  const rollCallByNumber = new Map(rollCalls.map((rc) => [rc.rollnumber, rc]));
  const enriched: MemberSenateVote[] = [];
  for (const v of votes) {
    if (v.icpsr !== member.icpsr) continue;
    const rollCall = rollCallByNumber.get(v.rollnumber);
    if (!rollCall) continue;
    enriched.push({ rollCall, cast_code: v.cast_code });
  }
  enriched.sort((a, b) => (b.rollCall.date ?? '').localeCompare(a.rollCall.date ?? ''));
  return enriched.slice(0, limit);
}
