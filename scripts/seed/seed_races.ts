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

/**
 * How many candidates are on this ballot, for the "showing N of M"
 * denominator (migration 017).
 *
 * Reads the fixture's candidate list, which is the FL DOE qualified spine,
 * and deliberately ignores `active`. The seeded rows hold only candidates
 * that cleared the evidence gate, so counting those would restate coverage
 * as the ballot — the exact defect this column exists to fix.
 *
 * Returns null rather than 0 when the fixture carries no candidate list.
 * Null means "unknown" and the UI falls back to its softer disclosure; a 0
 * would claim an empty ballot.
 */
export function ballotCandidateCount(fixture: {
  race?: { ballot_candidate_count?: number | null };
  candidates?: unknown[];
}): number | null {
  const explicit = fixture.race?.ballot_candidate_count;
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit >= 0) {
    return Math.floor(explicit);
  }
  if (!Array.isArray(fixture.candidates)) return null;
  return fixture.candidates.length;
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
        // Requires migration 013 (no-primary informational state, Spec A5).
        no_primary: r.no_primary ?? false,
        no_primary_note: r.no_primary_note ?? null,
        // Requires migration 017. The denominator for "showing N of M".
        //
        // Counted from the fixture's candidate list, which is the FL DOE
        // qualified spine — NOT from the seeded rows, which only ever hold
        // candidates that cleared the evidence gate. Counting seeded rows
        // would reproduce the very bug this column exists to fix.
        //
        // An explicit ballot_candidate_count on the race object wins, so a
        // race whose true ballot size differs from the fixture list can be
        // corrected without editing the roster.
        ballot_candidate_count: ballotCandidateCount(fixture),
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
