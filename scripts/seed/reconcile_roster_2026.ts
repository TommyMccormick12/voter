// Reconcile the production database with the verified 2026 roster fixtures.
//
// This is the one-shot seeder for the 2026-08-06 rework (SPEC A2/A5, gate T26).
// It is REPORT-FIRST: without --confirm it only prints what it would change.
//
// Phases:
//   A. Upsert every race found in supabase/seed/candidates/*.partial.json.
//   B. Re-gate fixture-active candidates through the activation gate
//      (>=3 stances + spine candidacy). Gate failures are flipped to
//      inactive in the fixture and reported — never seeded active.
//   C. Seed candidates race-by-race via the hardened seed_candidates logic
//      (spawned per race so its validation + abort semantics apply).
//   D. Deactivate DB candidates that are absent from the rebuilt fixtures
//      (rows are kept — engagement history stays intact).
//   E. Stale races (in DB but in no fixture): report referencing engagement
//      rows; with --confirm, delete engagement rows, candidates, then race.
//      These races do not exist on the 2026 ballot; leaving them would
//      render false "Curating" cards.
//   F. Post-checks: counts, the seven audit deactivations still inactive,
//      one incumbent max per race, no active candidate missing verified_at.
//
// Usage:
//   npx tsx scripts/seed/reconcile_roster_2026.ts            # report only
//   npx tsx scripts/seed/reconcile_roster_2026.ts --confirm  # execute

import '../_env';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { CANDIDATE_FIXTURE_DIR, REPO_ROOT } from '../../src/lib/api-clients/base';
import { getAdminClient } from './supabase-admin';

const AUDIT_SEVEN = [
  'marco-rubio',
  'rick-sen-scott',
  'byron-donalds',
  'vernon-buchanan',
  'daniel-webster',
  'anthony-sabatini',
  'alan-mark-grayson',
];

const ENGAGEMENT_TABLES = ['candidate_interactions', 'llm_matches', 'quick_poll_responses'] as const;

interface Fixture {
  file: string;
  race: { id: string } & Record<string, unknown>;
  candidates: Array<{ id?: string; slug: string; active?: boolean } & Record<string, unknown>>;
}

function loadFixtures(): Fixture[] {
  return readdirSync(CANDIDATE_FIXTURE_DIR)
    .filter((f) => f.endsWith('.partial.json'))
    .map((file) => {
      const data = JSON.parse(readFileSync(join(CANDIDATE_FIXTURE_DIR, file), 'utf8'));
      if (!data.race?.id || !Array.isArray(data.candidates)) {
        throw new Error(`Fixture ${file} missing race.id or candidates[]`);
      }
      return { file, race: data.race, candidates: data.candidates };
    });
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const admin = getAdminClient();
  const fixtures = loadFixtures();
  const fixtureRaceIds = new Set(fixtures.map((f) => f.race.id));
  const fixtureSlugs = new Set(fixtures.flatMap((f) => f.candidates.map((c) => c.slug)));
  console.log(`[reconcile] fixtures: ${fixtures.length} races, ${fixtureSlugs.size} candidates`);
  console.log(`[reconcile] mode: ${confirm ? 'CONFIRM (writing)' : 'report-only'}`);

  // Phase A — upsert races
  for (const f of fixtures) {
    if (!confirm) continue;
    execFileSync('npx', ['tsx', 'scripts/seed/seed_races.ts', '--race-id', f.race.id], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  }
  console.log(`[A] races upserted: ${confirm ? fixtures.length : `(would upsert ${fixtures.length})`}`);

  // Phase B — re-gate fixture-active candidates
  const gateFailures: string[] = [];
  for (const f of fixtures) {
    for (const c of f.candidates) {
      if (c.active !== true) continue;
      try {
        execFileSync(
          'npx',
          ['tsx', 'scripts/review/activate_candidate.ts', '--race-id', f.race.id, '--slug', c.slug],
          { cwd: REPO_ROOT, stdio: 'pipe', shell: process.platform === 'win32' }
        );
        console.log(`[B] gate PASS ${f.race.id}/${c.slug}`);
      } catch (err) {
        gateFailures.push(`${f.race.id}/${c.slug}`);
        console.error(`[B] gate FAIL ${f.race.id}/${c.slug} — flipping inactive in fixture`);
        if (confirm) {
          execFileSync(
            'npx',
            ['tsx', 'scripts/seed/set_active.ts', '--slugs', c.slug, '--active', 'false'],
            { cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32' }
          );
        }
      }
    }
  }

  // Phase C — seed candidates per race
  for (const f of fixtures) {
    if (!confirm) continue;
    execFileSync('npx', ['tsx', 'scripts/seed/seed_candidates.ts', '--race-id', f.race.id], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  }
  console.log(`[C] candidate seed: ${confirm ? 'done' : `(would seed ${fixtures.length} races)`}`);

  // Phase D — deactivate DB candidates absent from fixtures
  const { data: dbActive, error: dbActiveErr } = await admin
    .from('candidates')
    .select('slug, race_id')
    .eq('active', true);
  if (dbActiveErr) throw new Error(`Phase D read failed: ${dbActiveErr.message}`);
  const strays = (dbActive ?? []).filter((r) => !fixtureSlugs.has(r.slug));
  console.log(`[D] active DB candidates not in fixtures: ${strays.length}`, strays.map((s) => s.slug));
  if (confirm && strays.length > 0) {
    const { error } = await admin
      .from('candidates')
      .update({ active: false })
      .in('slug', strays.map((s) => s.slug));
    if (error) throw new Error(`Phase D update failed: ${error.message}`);
  }

  // Phase E — stale races
  const { data: dbRaces, error: dbRacesErr } = await admin.from('races').select('id');
  if (dbRacesErr) throw new Error(`Phase E read failed: ${dbRacesErr.message}`);
  const stale = (dbRaces ?? []).map((r) => r.id).filter((id) => !fixtureRaceIds.has(id));
  console.log(`[E] stale races (in DB, not on the 2026 ballot): ${stale.length}`, stale);
  for (const raceId of stale) {
    for (const table of ENGAGEMENT_TABLES) {
      const { count, error } = await admin
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('race_id', raceId);
      if (error) throw new Error(`Phase E count ${table} failed: ${error.message}`);
      console.log(`[E]   ${raceId}: ${table} rows=${count ?? 0}`);
      if (confirm && (count ?? 0) > 0) {
        const { error: delErr } = await admin.from(table).delete().eq('race_id', raceId);
        if (delErr) throw new Error(`Phase E delete ${table} failed: ${delErr.message}`);
      }
    }
    if (confirm) {
      const { error: candErr } = await admin.from('candidates').delete().eq('race_id', raceId);
      if (candErr) throw new Error(`Phase E delete candidates failed: ${candErr.message}`);
      const { error: raceErr } = await admin.from('races').delete().eq('id', raceId);
      if (raceErr) throw new Error(`Phase E delete race failed: ${raceErr.message}`);
      console.log(`[E]   deleted ${raceId}`);
    }
  }

  // Phase F — post-checks
  const { count: raceCount } = await admin.from('races').select('*', { count: 'exact', head: true });
  const { data: activeNow } = await admin
    .from('candidates')
    .select('slug, race_id, verified_at, incumbent')
    .eq('active', true);
  const { data: sevenRows } = await admin
    .from('candidates')
    .select('slug, active')
    .in('slug', AUDIT_SEVEN);
  const sevenStillActive = (sevenRows ?? []).filter((r) => r.active);
  const activeMissingVerified = (activeNow ?? []).filter((r) => !r.verified_at);
  const incumbentsPerRace = new Map<string, number>();
  for (const r of activeNow ?? []) {
    if (r.incumbent) {
      incumbentsPerRace.set(r.race_id, (incumbentsPerRace.get(r.race_id) ?? 0) + 1);
    }
  }
  const dupIncumbents = [...incumbentsPerRace.entries()].filter(([, n]) => n > 1);

  console.log('[F] post-checks:', {
    races: raceCount,
    active_candidates: activeNow?.length ?? 0,
    gate_failures: gateFailures,
    seven_still_active: sevenStillActive.map((r) => r.slug),
    active_missing_verified_at: activeMissingVerified.map((r) => r.slug),
    duplicate_incumbent_races: dupIncumbents,
  });
  const failed =
    sevenStillActive.length > 0 || (confirm && activeMissingVerified.length > 0) || dupIncumbents.length > 0;
  if (failed) {
    console.error('[F] POST-CHECK FAILURE — investigate before trusting production state');
    process.exit(1);
  }
  console.log('[reconcile] complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
