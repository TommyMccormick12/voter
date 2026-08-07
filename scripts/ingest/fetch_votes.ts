// Fetch congressional voting records for incumbent candidates only.
// Non-incumbents have no record (use statements instead).
//
// Source (T10 / spec B1.3 + B2, Decision 6): House via the Congress.gov
// official API (src/lib/api-clients/congress-gov.ts), Senate via Voteview
// CSV exports (src/lib/api-clients/voteview.ts). Both key votes by
// bioguide ID. The GovTrack scrape client (govtrack.ts) and its
// `matchRoleByName` name-matching fallback are deleted — that fallback is
// the confirmed root cause of the Royal-Webster-vs-Daniel-Webster
// misattribution in DATA-AUDIT-2026-08-06 (a challenger with no bioguide
// inherited an incumbent's govtrack_id and voting record via a last-name
// match). Matching here is ID-only: a candidate's `fec_candidate_id`
// (assigned upstream by the DOE/FEC entity spine, T02/fetch_fec.ts) is
// looked up in the congress-legislators crosswalk
// (src/lib/api-clients/legislators.ts); either it resolves to exactly one
// bioguide or the candidate has no voting record. No name is ever read.
//
// Usage:
//   CONGRESS_GOV_API_KEY=... npx tsx scripts/ingest/fetch_votes.ts \
//     --race-id race-fl-10-r-2026 --state FL --chamber house
//
// Caching: every API/CSV response is cached to supabase/seed/raw/ via
// fetchCached/fetchCachedText, so re-runs are free.

import '../_env';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  fetchLegislators,
  buildFecToBioguideIndex,
} from '../../src/lib/api-clients/legislators';
import {
  getMemberHouseVotes,
  billIdFromHouseVote,
  billUrlFromHouseVote,
  normalizeVoteCast,
  CURRENT_CONGRESS,
  type MemberHouseVote,
} from '../../src/lib/api-clients/congress-gov';
import {
  getMemberSenateVotes,
  billIdFromRollCall,
  normalizeCastCode,
  type MemberSenateVote,
} from '../../src/lib/api-clients/voteview';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';
import { inferIssueSlugs } from '../../src/lib/issue-keywords';

const VOTES_PER_CANDIDATE = 50;

interface Args {
  raceId: string;
  state: string;
  chamber: 'house' | 'senate';
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId = '';
  let state = '';
  let chamber: 'house' | 'senate' = 'house';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
    if (args[i] === '--state') state = args[++i] ?? '';
    if (args[i] === '--chamber') chamber = (args[++i] ?? 'house') as 'house' | 'senate';
  }
  if (!raceId || !state) {
    console.error('Usage: --race-id "..." --state FL [--chamber house|senate]');
    process.exit(1);
  }
  return { raceId, state, chamber };
}

// Bill-title → issue slug mapping. Shared with fetch_gdelt_statements.ts
// via src/lib/issue-keywords.ts so the two ingesters can't drift apart on
// which keywords map to which slug.
function inferIssues(billTitle: string, billSummary: string | null): string[] {
  return inferIssueSlugs(`${billTitle} ${billSummary ?? ''}`);
}

// ============================================================
// Fixture shapes
// ============================================================

export interface VoteRecordRow {
  bill_id: string;
  bill_title: string;
  bill_summary: string | null;
  vote: 'yea' | 'nay' | 'present' | 'absent' | 'no_vote';
  issue_slugs: string[];
  vote_date: string;
  source: 'congress_gov' | 'voteview';
  source_url: string | null;
  significance: 'major' | 'procedural';
  /**
   * Roll-call identity, distinct from `bill_id`: House =
   * "house-{congress}-{session}-{rollCallNumber}", Senate =
   * "senate-{congress}-{rollnumber}". Two rows can legitimately share one
   * `bill_id` (e.g. a Nay on the Motion to Recommit, a Yea on Passage of
   * the same bill) — this field is what identifies a single, unrepeatable
   * roll call, so it's the correct key for the contradiction check below.
   * Not written to the DB (seed_candidates.ts whitelists insert columns
   * and does not include it); it exists only to make this fixture-stage
   * check correct.
   */
  roll_call_id: string;
}

export interface VoteCandidate {
  name?: string;
  fec_candidate_id?: string;
  bioguide_id?: string;
  incumbent?: boolean;
  voting_record?: VoteRecordRow[];
  [key: string]: unknown;
}

// ============================================================
// Loud-failure validation (spec B1 tail / B4): these two bug classes must
// be impossible in written output, not just rare.
// ============================================================

/** Throws when any row has a missing/empty/literal-"undefined" bill_id.
 * DATA-AUDIT-2026-08-06: 20 Senate voting entries had bill_id
 * "vote-undefined" from an unguarded template-literal interpolation. */
export function assertNoUndefinedBillIds(rows: VoteRecordRow[], label: string): void {
  for (const row of rows) {
    const id = row.bill_id;
    if (!id || typeof id !== 'string' || /undefined/i.test(id)) {
      throw new Error(
        `[votes] ${label}: invalid bill_id "${String(id)}" on a voting_record row — refusing to write. ` +
          `Every row must carry a real bill_id or a non-undefined fallback (housevote-*/senatevote-*).`,
      );
    }
  }
}

/** Throws when the same roll call appears twice for one candidate with
 * different `vote` values. DATA-AUDIT-2026-08-06 originally found 89
 * bill/candidate pairs with both YEA and NAY recorded against one
 * `bill_id` — but a single bill legitimately carries multiple distinct
 * roll calls (e.g. a Nay on the Motion to Recommit, then a Yea on Passage
 * of the same bill), so `bill_id` is the wrong key: it conflated those
 * routine, legitimate cases with real contradictions and aborted the
 * ingest on both. The check is keyed on `roll_call_id` instead — a single
 * member casting two different positions on the SAME roll call is the
 * only case that can never legitimately happen. */
export function assertNoYeaNayContradiction(rows: VoteRecordRow[], label: string): void {
  const seen = new Map<string, VoteRecordRow>();
  for (const row of rows) {
    const prior = seen.get(row.roll_call_id);
    if (prior && prior.vote !== row.vote) {
      throw new Error(
        `[votes] ${label}: contradictory positions on roll call "${row.roll_call_id}" ` +
          `(bill_id "${row.bill_id}") (${prior.vote} then ${row.vote}) — refusing to write.`,
      );
    }
    seen.set(row.roll_call_id, row);
  }
}

function houseVotesToRows(votes: MemberHouseVote[]): VoteRecordRow[] {
  return votes.map(({ vote, position }) => {
    const billId =
      billIdFromHouseVote(vote) ??
      `housevote-${vote.congress}-${vote.sessionNumber}-${vote.rollCallNumber}`;
    const title = vote.voteQuestion ?? `House roll call ${vote.rollCallNumber}`;
    const summary = vote.result ?? null;
    return {
      bill_id: billId,
      bill_title: title,
      bill_summary: summary,
      vote: normalizeVoteCast(position.voteCast),
      issue_slugs: inferIssues(title, summary),
      vote_date: vote.startDate.slice(0, 10),
      source: 'congress_gov',
      source_url: billUrlFromHouseVote(vote),
      significance: vote.legislationType || vote.amendmentType ? 'major' : 'procedural',
      roll_call_id: `house-${vote.congress}-${vote.sessionNumber}-${vote.rollCallNumber}`,
    };
  });
}

function senateVotesToRows(votes: MemberSenateVote[]): VoteRecordRow[] {
  return votes.map(({ rollCall, cast_code }) => {
    const billId =
      billIdFromRollCall(rollCall) ?? `senatevote-${rollCall.congress}-${rollCall.rollnumber}`;
    const title = rollCall.vote_desc ?? rollCall.vote_question ?? `Senate roll call ${rollCall.rollnumber}`;
    const summary = rollCall.vote_result ?? null;
    return {
      bill_id: billId,
      bill_title: title,
      bill_summary: summary,
      vote: normalizeCastCode(cast_code),
      issue_slugs: inferIssues(title, summary),
      vote_date: rollCall.date,
      source: 'voteview',
      source_url: null,
      significance: rollCall.bill_number ? 'major' : 'procedural',
      roll_call_id: `senate-${rollCall.congress}-${rollCall.rollnumber}`,
    };
  });
}

export interface AttachVotingRecordsOptions {
  chamber: 'house' | 'senate';
  congress?: number;
}

/**
 * Attach voting_record to each candidate, mutating in place. ID-only:
 * `fec_candidate_id` is looked up in `fecToBioguide`; a miss means a
 * non-incumbent challenger (no name-based fallback exists or is attempted).
 * Exported + injectable (fecToBioguide is passed in, not fetched here) so
 * this is unit-testable against mocked congress-gov/voteview clients with
 * no network or fs access — see tests/fetch_votes.test.ts.
 */
export async function attachVotingRecords(
  candidates: VoteCandidate[],
  fecToBioguide: Map<string, string>,
  { chamber, congress = CURRENT_CONGRESS }: AttachVotingRecordsOptions,
): Promise<void> {
  for (const c of candidates) {
    const label = typeof c.name === 'string' && c.name ? c.name : '(unnamed candidate)';
    const fecId = typeof c.fec_candidate_id === 'string' ? c.fec_candidate_id : undefined;
    const bioguideId = fecId ? fecToBioguide.get(fecId) : undefined;

    if (!bioguideId) {
      console.log(
        `[votes] ${label}: no bioguide match (challenger, or no fec_candidate_id yet) — no voting record`,
      );
      c.incumbent = false;
      c.voting_record = [];
      continue;
    }

    console.log(`[votes] ${label} -> bioguide=${bioguideId}`);
    c.incumbent = true;
    c.bioguide_id = bioguideId;

    const rows =
      chamber === 'house'
        ? houseVotesToRows(await getMemberHouseVotes(bioguideId, congress, [2, 1], VOTES_PER_CANDIDATE))
        : senateVotesToRows(await getMemberSenateVotes(bioguideId, congress, VOTES_PER_CANDIDATE));

    assertNoUndefinedBillIds(rows, label);
    assertNoYeaNayContradiction(rows, label);

    c.voting_record = rows;
    console.log(`[votes] ${label}: ${rows.length} votes captured`);
  }
}

async function main() {
  const { raceId, state, chamber } = parseArgs();
  console.log(`[votes] ${raceId} (${state}, ${chamber}) — ID-only crosswalk, no name matching`);
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`Partial fixture missing: ${partialPath}. Run fetch_fec/fetch_ballotpedia first.`);
    process.exit(1);
  }
  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const candidates: VoteCandidate[] = fixture.candidates ?? [];

  const legislators = await fetchLegislators();
  const fecToBioguide = buildFecToBioguideIndex(legislators);

  await attachVotingRecords(candidates, fecToBioguide, { chamber });

  writeFileSync(partialPath, JSON.stringify(fixture, null, 2));
  console.log(`[votes] wrote ${partialPath}`);
}

// Only run the CLI when this file is the process entry point — importing
// attachVotingRecords/assertNo* from tests must never parse argv or call
// process.exit.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
