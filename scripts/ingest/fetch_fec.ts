// Fetch FEC totals for cross-checking OpenSecrets numbers.
// FEC has the raw filings; OpenSecrets aggregates them with a delay.
// If they disagree, FEC wins (it's the source of truth).
//
// Usage:
//   FEC_API_KEY=... npx tsx scripts/ingest/fetch_fec.ts \
//     --race-id race-nj-07-r-2026 --state NJ --district 07 --cycle 2026

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  searchCandidates,
  getCandidateTotals,
} from '../../src/lib/api-clients/fec';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';

interface Args {
  raceId: string;
  state: string;
  district?: string;
  cycle: number;
  office: 'H' | 'S' | 'P';
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId = '';
  let state = '';
  let district: string | undefined;
  let cycle = 2026;
  let office: 'H' | 'S' | 'P' = 'H';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
    if (args[i] === '--state') state = args[++i] ?? '';
    if (args[i] === '--district') district = args[++i] ?? '';
    if (args[i] === '--cycle') cycle = parseInt(args[++i] ?? '', 10);
    if (args[i] === '--office') office = (args[++i] ?? 'H').toUpperCase() as 'H' | 'S' | 'P';
  }
  if (!raceId || !state) {
    console.error('Usage: --race-id "..." --state NJ [--district 07] [--cycle 2026] [--office H|S|P]');
    process.exit(1);
  }
  return { raceId, state, district, cycle, office };
}

async function main() {
  const { raceId, state, district, cycle, office } = parseArgs();
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`Partial fixture missing: ${partialPath}`);
    process.exit(1);
  }
  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const candidates: Array<Record<string, unknown> & { name?: string }> =
    fixture.candidates ?? [];

  // Pull all FEC candidates registered for this race
  const fecCandidates = await searchCandidates({ state, district, cycle, office });
  console.log(`[fec] ${fecCandidates.length} candidates registered for ${state}-${district ?? 'sen'} ${cycle}`);

  for (const c of candidates) {
    if (!c.name || typeof c.name !== 'string') continue;
    const lower = c.name.toLowerCase();
    const match = fecCandidates.find((fc) =>
      fc.name.toLowerCase().includes(lower) || lower.includes(fc.name.toLowerCase())
    );
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
