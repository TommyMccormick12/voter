// Generalized overnight sweep: run one ingest script across every race
// that holds an inactive candidate.
//
//   SWEEP_LOG=... SWEEP_SCRIPT=ingest:platform node run-sweep.mjs
//
// Sequential on purpose. Each race rewrites its own fixture file, and the
// upstream APIs are rate-sensitive.
import { readFileSync, readdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const DIR = 'supabase/seed/candidates';
const LOG = process.env.SWEEP_LOG;
const SCRIPT = process.env.SWEEP_SCRIPT;
const PASS_STATE = process.env.SWEEP_PASS_STATE === '1';

function log(line) {
  console.log(line);
  appendFileSync(LOG, line + '\n', 'utf8');
}

const races = [];
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  const fx = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  if ((fx.candidates || []).some((c) => c.active !== true)) races.push(fx.race.id);
}

writeFileSync(LOG, `SWEEP ${SCRIPT} — ${races.length} races\n`, 'utf8');

let i = 0;
for (const raceId of races) {
  i += 1;
  log(`=== [${i}/${races.length}] ${raceId} ===`);
  const argv = ['run', SCRIPT, '--', '--race-id', raceId];
  if (PASS_STATE) argv.push('--state', 'FL');
  const r = spawnSync('npm', argv, {
    encoding: 'utf8',
    shell: true,
    timeout: 20 * 60 * 1000,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (out) log(out);
  if (r.status !== 0) log(`NONZERO EXIT (${r.status}) for ${raceId} — continuing`);
}

log(`SWEEP COMPLETE — ${SCRIPT}`);
