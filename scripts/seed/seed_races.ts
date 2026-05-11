// Insert race rows from a fixture file into Supabase races table.
// Idempotent: uses upsert on (state, district, office, election_date).
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed/seed_races.ts \
//     --race-id race-nj-07-r-2026

import '../_env';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';
import { getAdminClient } from './supabase-admin';

interface Args {
  raceId: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
  }
  if (!raceId) {
    console.error('Usage: --race-id "..."');
    process.exit(1);
  }
  return { raceId };
}

async function main() {
  const { raceId } = parseArgs();
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`Fixture missing: ${partialPath}`);
    process.exit(1);
  }
  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const r = fixture.race;
  if (!r) {
    console.error('Fixture missing .race object');
    process.exit(1);
  }

  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('races')
    .upsert(
      {
        id: r.id,
        state: r.state,
        district: r.district ?? null,
        office: r.office,
        election_date: r.election_date,
        cycle: r.cycle,
        election_type: r.election_type ?? 'primary',
        primary_party: r.primary_party ?? null,
      },
      { onConflict: 'id' }
    )
    .select('id')
    .single();

  if (error) {
    console.error('[seed-race] error:', error.message);
    process.exit(1);
  }
  console.log(`[seed-race] upserted race ${data?.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
