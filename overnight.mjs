// Overnight orchestrator for the challenger-coverage experiment.
//
// Context: on 2026-08-08 both Wikidata and GDELT began returning HTTP 429
// to this IP — GDELT even to a single isolated request. That is a penalty
// window, not burst limiting, so the only useful move is to wait and then
// go slowly. The two sweeps run SEQUENTIALLY and never overlap: they share
// one IP budget, and running them together is what earns a second penalty.
//
// Each stage probes its own API first and skips if still limited, so a
// stage can never turn into a retry storm.
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const LOG = process.env.OVERNIGHT_LOG;
const SCRATCH = process.env.SCRATCH_DIR;
const COOLDOWN_MS = 45 * 60 * 1000;
const PROBE_EVERY_MS = 20 * 60 * 1000;
const MAX_PROBES = 12; // ~4h per stage

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  appendFileSync(LOG, stamped + '\n', 'utf8');
}

const PROBES = {
  wikidata:
    'https://www.wikidata.org/w/api.php?action=wbsearchentities&search=test&language=en&format=json',
  gdelt:
    'https://api.gdeltproject.org/api/v2/doc/doc?query=%22Florida%22&mode=artlist&maxrecords=1&timespan=1months&format=json',
};

async function isClear(which) {
  try {
    const res = await fetch(PROBES[which]);
    if (res.status !== 200) return { ok: false, why: `HTTP ${res.status}` };
    const text = await res.text();
    try {
      JSON.parse(text);
      return { ok: true };
    } catch {
      return { ok: false, why: `HTTP 200 non-JSON: ${text.slice(0, 60)}` };
    }
  } catch (err) {
    return { ok: false, why: `fetch failed: ${err.message}` };
  }
}

async function waitUntilClear(which) {
  for (let i = 1; i <= MAX_PROBES; i++) {
    const r = await isClear(which);
    if (r.ok) {
      log(`${which}: clear on probe ${i}`);
      return true;
    }
    log(`${which}: still limited on probe ${i} (${r.why}) — waiting 20m`);
    await sleep(PROBE_EVERY_MS);
  }
  log(`${which}: never cleared — skipping its sweep`);
  return false;
}

function runSweep(script, logName, extraEnv) {
  log(`starting sweep: ${script}`);
  const r = spawnSync('node', ['run-sweep.mjs'], {
    encoding: 'utf8',
    shell: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      SWEEP_SCRIPT: script,
      SWEEP_LOG: `${SCRATCH}/${logName}`,
      ...extraEnv,
    },
  });
  log(`sweep ${script} finished with status ${r.status}`);
}

writeFileSync(LOG, 'OVERNIGHT ORCHESTRATOR\n', 'utf8');
log(`cooling down ${COOLDOWN_MS / 60000}m before touching either API`);
await sleep(COOLDOWN_MS);

// Wikipedia/Wikidata first: it self-gates on a real candidacy record, so a
// wrong hit is impossible, and it is the cheaper of the two to retry.
if (await waitUntilClear('wikidata')) {
  runSweep('ingest:platform', 'platform-retry.log', {});
}

log('pausing 15m between stages so the two sweeps never share a window');
await sleep(15 * 60 * 1000);

if (await waitUntilClear('gdelt')) {
  runSweep('ingest:gdelt', 'gdelt.log', {
    SWEEP_PASS_STATE: '1',
    GDELT_MIN_SEARCH_GAP_MS: '15000',
    GDELT_RETRY_GAP_MS: '60000',
    GDELT_MAX_RETRY_ATTEMPTS: '3',
  });
}

log('OVERNIGHT ORCHESTRATOR COMPLETE');
