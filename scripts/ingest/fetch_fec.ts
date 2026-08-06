// Fetch FEC totals for cross-checking OpenSecrets numbers.
// FEC has the raw filings; OpenSecrets aggregates them with a delay.
// If they disagree, FEC wins (it's the source of truth).
//
// Money attachment (T11 / spec B1.4, B3): candidate_id is an INPUT to this
// script — every candidate must already carry `fec_candidate_id` (assigned
// upstream by the DOE/FEC entity spine, T02) before money is fetched.
// attachFecTotals() below never searches FEC by name and never attaches an
// ID by matching name substrings. That substring-match path used to exist
// here and is the confirmed root cause of two DATA-AUDIT-2026-08-06
// findings: Joshua Weil appearing twice under two FEC IDs (one row $0, the
// other $15.9M), and Angela Walls-Windhauser duplicated. It has been
// removed entirely, not just tightened.
//
// Cycle pinning (T11 / spec B3): totals are fetched for exactly one cycle
// (2026 House, or Senate's election_full/election_year=2026 window) and
// never retried against another cycle. A candidate with no 2026 rows gets
// an explicit `{ no2026Filings: true }` marker — this is how prior-cycle
// money (Scott's trailing $1.46M, Grayson's stale $178K) leaked into 2026
// figures previously: a failed pull silently left the last successful
// pull's numbers in place instead of saying so.
//
// Usage:
//   FEC_API_KEY=... npx tsx scripts/ingest/fetch_fec.ts \
//     --race-id race-nj-07-r-2026 --state NJ --district 07 --cycle 2026
//
// Testing: attachFecTotals is exported and pure aside from the injected
// FEC client call, so it's unit-testable with a mocked
// `src/lib/api-clients/fec` module — no disk cache, no real network call.
// main() only runs when this file is the process entry point (see the
// import.meta.url guard at the bottom), so importing this module for tests
// never triggers a CLI run or process.exit.

import '../_env';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  searchCandidates,
  getCandidateTotals,
  type FecCommitteeTotals,
} from '../../src/lib/api-clients/fec';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';
import { normalizeFecName } from '../../src/lib/api-clients/names';

interface Args {
  raceId: string;
  state: string;
  district?: string;
  cycle: number;
  office: 'H' | 'S' | 'P';
  /** If provided, seeds candidates from FEC filtered by party (D | R) when fixture is empty. */
  primaryParty?: 'D' | 'R';
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId = '';
  let state = '';
  let district: string | undefined;
  let cycle = 2026;
  let office: 'H' | 'S' | 'P' = 'H';
  let primaryParty: 'D' | 'R' | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
    if (args[i] === '--state') state = args[++i] ?? '';
    if (args[i] === '--district') district = args[++i] ?? '';
    if (args[i] === '--cycle') cycle = parseInt(args[++i] ?? '', 10);
    if (args[i] === '--office') office = (args[++i] ?? 'H').toUpperCase() as 'H' | 'S' | 'P';
    if (args[i] === '--primary-party') primaryParty = (args[++i] ?? '').toUpperCase() as 'D' | 'R';
  }
  if (!raceId || !state) {
    console.error('Usage: --race-id "..." --state NJ [--district 07] [--cycle 2026] [--office H|S|P] [--primary-party D|R]');
    process.exit(1);
  }
  return { raceId, state, district, cycle, office, primaryParty };
}

/** Shape money attaches to. Only `fec_candidate_id` and `name` (for
 * logging) are read; every other field passes through untouched. */
export interface MoneyCandidate {
  name?: string;
  fec_candidate_id?: string;
  total_raised?: number;
  fec_totals?: FecCommitteeTotals | { no2026Filings: true };
  [key: string]: unknown;
}

export interface AttachFecTotalsOptions {
  cycle: number;
  office: 'H' | 'S' | 'P';
}

/**
 * Attach FEC totals to each candidate, joined by `fec_candidate_id` only.
 * Mutates each candidate record in place:
 *
 *   - `fec_candidate_id` present, rows found for `cycle`/`office`  ->
 *     `total_raised` + `fec_totals` (the latter carries
 *     `coverage_end_date` — see FecCommitteeTotals).
 *   - `fec_candidate_id` present, no rows for `cycle`/`office`      ->
 *     `fec_totals = { no2026Filings: true }`; `total_raised` is
 *     deleted rather than left holding a stale prior-run value.
 *   - `fec_candidate_id` missing                                    ->
 *     skipped with a warning. No name-based search or substring
 *     attachment is attempted — that path has been removed (T11).
 */
export async function attachFecTotals(
  candidates: MoneyCandidate[],
  { cycle, office }: AttachFecTotalsOptions,
): Promise<void> {
  for (const c of candidates) {
    const label = typeof c.name === 'string' && c.name ? c.name : '(unnamed candidate)';
    const candidateId = typeof c.fec_candidate_id === 'string' && c.fec_candidate_id
      ? c.fec_candidate_id
      : undefined;

    if (!candidateId) {
      console.warn(
        `[fec] ${label}: no fec_candidate_id on record; skipping money (no name-based lookup allowed)`,
      );
      continue;
    }

    const totals = await getCandidateTotals(candidateId, { cycle, office });
    if (!totals) {
      console.warn(`[fec] ${label}: no ${cycle} filings for ${candidateId} (office ${office})`);
      c.fec_totals = { no2026Filings: true };
      delete c.total_raised;
      continue;
    }

    console.log(`[fec] ${label} (${candidateId}): $${totals.receipts.toLocaleString()} through ${totals.coverage_end_date ?? 'unknown'}`);
    c.total_raised = totals.receipts;
    c.fec_totals = totals;
  }
}

async function main() {
  const { raceId, state, district, cycle, office, primaryParty } = parseArgs();
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);

  // Load (or initialize) fixture. We allow fetch_fec.ts to be the
  // first step in the pipeline when Ballotpedia coverage is thin —
  // FEC has the authoritative candidate list for federal races.
  let fixture: {
    race_id?: string;
    race?: Record<string, unknown>;
    candidates?: MoneyCandidate[];
  };
  if (existsSync(partialPath)) {
    fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  } else {
    console.log(`[fec] no existing fixture; will create one at ${partialPath}`);
    fixture = { race_id: raceId, candidates: [] };
  }
  let candidates = fixture.candidates ?? [];

  // Construct or fill in the `race` object — seed_races.ts requires it.
  // Election date hardcoded per state primary calendar (FL = Aug 18 2026
  // for federal primaries; expand this map as more states ingest).
  const PRIMARY_DATES: Record<string, string> = {
    FL: '2026-08-18',
  };
  const officeLabel: Record<'H' | 'S' | 'P', string> = {
    H: 'U.S. House',
    S: 'U.S. Senate',
    P: 'President',
  };
  fixture.race = {
    id: raceId,
    state,
    district: district ?? null,
    office: officeLabel[office] ?? 'U.S. House',
    election_date: PRIMARY_DATES[state] ?? `${cycle}-08-18`,
    cycle,
    election_type: 'primary',
    primary_party: primaryParty ?? null,
    ...(fixture.race ?? {}), // preserve any prior overrides (e.g. from Ballotpedia)
  };

  // Roster bootstrap only — NOT part of the money flow. Only runs when the
  // fixture has no candidates yet (Ballotpedia stub scenarios). Each
  // candidate is built directly from one FEC search result (fc.candidate_id
  // carried straight through), so this is not name matching: there is no
  // step here that guesses which search result belongs to which candidate.
  if (candidates.length === 0) {
    if (!primaryParty) {
      console.error('[fec] fixture empty and no --primary-party flag; cannot infer who to seed. Aborting.');
      process.exit(1);
    }
    const fecCandidates = await searchCandidates({ state, district, cycle, office });
    console.log(`[fec] ${fecCandidates.length} candidates registered for ${state}-${district ?? 'sen'} ${cycle}`);

    const partyMap: Record<'D' | 'R', RegExp> = { D: /^DEM$|^DFL$/i, R: /^REP$/i };
    const filtered = fecCandidates.filter(
      (fc) =>
        partyMap[primaryParty].test(fc.party) &&
        fc.cycles.includes(cycle) &&
        fc.active_through >= cycle,
    );
    candidates = filtered.map((fc) => ({
      name: normalizeFecName(fc.name),
      party: fc.party_full,
      primary_party: primaryParty,
      slug: normalizeFecName(fc.name).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      incumbent: fc.incumbent_challenge === 'I',
      state,
      district: district ?? null,
      office: office === 'H' ? 'U.S. House' : office === 'S' ? 'U.S. Senate' : 'President',
      race_id: raceId,
      fec_candidate_id: fc.candidate_id,
    }));
    fixture.candidates = candidates;
    fixture.race_id = raceId;
    console.log(`[fec] seeded ${candidates.length} ${primaryParty} candidates from FEC filings`);
  }

  // Money — ID-only, cycle-pinned, no fallback. See attachFecTotals docs.
  await attachFecTotals(candidates, { cycle, office });

  writeFileSync(partialPath, JSON.stringify(fixture, null, 2));
  console.log(`[fec] wrote ${partialPath}`);
}

// Only run the CLI when this file is the process entry point. Importing
// this module (e.g. from a test) must never parse argv or call
// process.exit — that guard is what makes attachFecTotals importable and
// unit-testable in isolation.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
