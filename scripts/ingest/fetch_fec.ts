// Fetch FEC totals for cross-checking OpenSecrets numbers.
// FEC has the raw filings; OpenSecrets aggregates them with a delay.
// If they disagree, FEC wins (it's the source of truth).
//
// Usage:
//   FEC_API_KEY=... npx tsx scripts/ingest/fetch_fec.ts \
//     --race-id race-nj-07-r-2026 --state NJ --district 07 --cycle 2026

import '../_env';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  searchCandidates,
  getCandidateTotals,
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

async function main() {
  const { raceId, state, district, cycle, office, primaryParty } = parseArgs();
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);

  // Load (or initialize) fixture. We allow fetch_fec.ts to be the
  // first step in the pipeline when Ballotpedia coverage is thin —
  // FEC has the authoritative candidate list for federal races.
  let fixture: {
    race_id?: string;
    race?: Record<string, unknown>;
    candidates?: Array<Record<string, unknown> & { name?: string }>;
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

  // Pull all FEC candidates registered for this race
  const fecCandidates = await searchCandidates({ state, district, cycle, office });
  console.log(`[fec] ${fecCandidates.length} candidates registered for ${state}-${district ?? 'sen'} ${cycle}`);

  // Seed from FEC if the fixture has no candidates yet (Ballotpedia stub
  // scenarios). Filter to primary party + active-through current cycle so
  // we don't pull in stale prior-cycle filers.
  if (candidates.length === 0) {
    if (!primaryParty) {
      console.error('[fec] fixture empty and no --primary-party flag; cannot infer who to seed. Aborting.');
      process.exit(1);
    }
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
    }));
    fixture.candidates = candidates;
    fixture.race_id = raceId;
    console.log(`[fec] seeded ${candidates.length} ${primaryParty} candidates from FEC filings`);
  }

  for (const c of candidates) {
    if (!c.name || typeof c.name !== 'string') continue;
    const lower = c.name.toLowerCase();
    const match = fecCandidates.find((fc) => {
      const normalized = normalizeFecName(fc.name).toLowerCase();
      return normalized.includes(lower) || lower.includes(normalized);
    });
    if (!match) {
      console.log(`[fec] no FEC match for ${c.name}`);
      continue;
    }
    console.log(`[fec] ${c.name} → ${match.candidate_id}`);
    const totals = await getCandidateTotals(match.candidate_id, cycle);
    c.fec_candidate_id = match.candidate_id;
    if (totals) {
      // Prefer FEC totals (source of truth) over OpenSecrets aggregation
      c.total_raised = totals.receipts;
      c.fec_totals = totals;
    }
  }

  writeFileSync(partialPath, JSON.stringify(fixture, null, 2));
  console.log(`[fec] wrote ${partialPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
