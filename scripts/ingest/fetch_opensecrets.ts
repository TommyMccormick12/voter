// Fetch OpenSecrets data for each candidate in a race fixture.
// Reads candidates from the partial fixture (built by fetch_ballotpedia)
// and matches them by name + state to OpenSecrets CIDs, then pulls
// summary + top industries + top contributors.
//
// Usage:
//   OPENSECRETS_API_KEY=... npx tsx scripts/ingest/fetch_opensecrets.ts \
//     --race-id race-nj-07-r-2026 --state NJ --cycle 2026

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  getCandidatesByState,
  getCandSummary,
  getCandIndustries,
  getCandContributors,
} from '../../src/lib/api-clients/opensecrets';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';

interface Args {
  raceId: string;
  state: string;
  cycle: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId = '';
  let state = '';
  let cycle = 2026;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
    if (args[i] === '--state') state = args[++i] ?? '';
    if (args[i] === '--cycle') cycle = parseInt(args[++i] ?? '', 10);
  }
  if (!raceId || !state) {
    console.error('Usage: --race-id "..." --state NJ [--cycle 2026]');
    process.exit(1);
  }
  return { raceId, state, cycle };
}

async function main() {
  const { raceId, state, cycle } = parseArgs();
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(
      `Partial fixture missing: ${partialPath}. Run fetch_ballotpedia first.`
    );
    process.exit(1);
  }

  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const candidates: Array<Record<string, unknown> & { name?: string }> =
    fixture.candidates ?? [];

  // OpenSecrets only covers SITTING legislators in getLegislators. New
  // challengers won't appear. For the cycle's full slate, fall back to
  // candSearch if available; for now, match incumbent names only.
  const legislators = await getCandidatesByState(cycle, state);
  const byName = new Map(legislators.map((l) => [l.firstlast.toLowerCase(), l]));

  for (const c of candidates) {
    if (!c.name || typeof c.name !== 'string') continue;
    const lookup = byName.get(c.name.toLowerCase());
    if (!lookup) {
      console.log(`[opensecrets] no CID match for ${c.name} (likely a challenger)`);
      continue;
    }
    const cid = lookup.cid;
    console.log(`[opensecrets] ${c.name} → CID=${cid}`);

    const [summary, industries, contributors] = await Promise.all([
      getCandSummary(cid, cycle),
      getCandIndustries(cid, cycle),
      getCandContributors(cid, cycle),
    ]);

    c.opensecrets_cid = cid;
    c.total_raised = summary?.total ?? null;
    c.top_industries = industries.slice(0, 10).map((ind, idx) => ({
      industry_name: ind.industry_name,
      industry_code: ind.industry_code,
      amount: ind.total,
      rank: idx + 1,
      cycle,
      data_source: 'opensecrets',
    }));
    c.donors = contributors.slice(0, 10).map((d, idx) => ({
      donor_name: d.org_name,
      donor_type: 'pac',
      industry: null,
      amount_total: d.total,
      cycle,
      fec_committee_id: null,
      data_source: 'opensecrets',
      rank_in_candidate: idx + 1,
    }));
  }

  writeFileSync(partialPath, JSON.stringify(fixture, null, 2));
  console.log(`[opensecrets] wrote ${partialPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
