// Overnight sweep: GDELT statement mining for every race that holds an
// inactive candidate. Sequential — GDELT is rate-sensitive and each race
// rewrites its own fixture file.
import { readFileSync, readdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const DIR = 'supabase/seed/candidates';
const LOG = process.env.SWEEP_LOG;

function log(line) {
  console.log(line);
  appendFileSync(LOG, line + '\n', 'utf8');
}

const races = [];
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  const fx = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  if ((fx.candidates || []).some((c) => c.active !== true)) races.push(fx.race.id);
}

writeFileSync(LOG, `GDELT SWEEP — ${races.length} races\n`, 'utf8');

let i = 0;
for (const raceId of races) {
  i += 1;
  log(`=== [${i}/${races.length}] ${raceId} ===`);
  const r = spawnSync(
    'npm',
    ['run', 'ingest:gdelt', '--', '--race-id', raceId, '--state', 'FL'],
    { encoding: 'utf8', shell: true, timeout: 15 * 60 * 1000 },
  );
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (out) log(out);
  if (r.status !== 0) log(`NONZERO EXIT (${r.status}) for ${raceId} — continuing`);
}

log('GDELT SWEEP COMPLETE');
