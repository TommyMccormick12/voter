// GDELT returned HTTP 429 to a single isolated request, so the whole IP is
// in a penalty window, not merely burst-limited — no amount of pacing gets
// past that. This probes with ONE request on a long interval and starts the
// sweep only once GDELT actually answers with JSON. Probing rarely is the
// point: hammering is what earns the penalty in the first place.
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const LOG = process.env.WATCH_LOG;
const PROBE_INTERVAL_MS = 20 * 60 * 1000; // 20 min
const MAX_WAIT_MS = 7 * 60 * 60 * 1000; // give up after 7h
const PROBE_URL =
  'https://api.gdeltproject.org/api/v2/doc/doc?query=%22Florida%22&mode=artlist&maxrecords=1&timespan=1months&format=json';

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  appendFileSync(LOG, stamped + '\n', 'utf8');
}

writeFileSync(LOG, 'GDELT WATCHER — probing until the rate-limit penalty clears\n', 'utf8');

async function probe() {
  try {
    const res = await fetch(PROBE_URL);
    if (res.status !== 200) return { ok: false, why: `HTTP ${res.status}` };
    const text = await res.text();
    try {
      JSON.parse(text);
      return { ok: true };
    } catch {
      return { ok: false, why: `HTTP 200 but non-JSON: ${text.slice(0, 80)}` };
    }
  } catch (err) {
    return { ok: false, why: `fetch failed: ${err.message}` };
  }
}

const startedAt = Date.now();
let attempt = 0;

while (Date.now() - startedAt < MAX_WAIT_MS) {
  attempt += 1;
  const r = await probe();
  if (r.ok) {
    log(`probe ${attempt}: GDELT responding — starting sweep`);
    const run = spawnSync('node', ['run-sweep.mjs'], {
      encoding: 'utf8',
      shell: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        SWEEP_LOG: process.env.SWEEP_LOG,
        SWEEP_SCRIPT: 'ingest:gdelt',
        SWEEP_PASS_STATE: '1',
        // Well clear of the documented 1-per-5s limit. Overnight has the
        // time; a second penalty window does not.
        GDELT_MIN_SEARCH_GAP_MS: '15000',
        GDELT_RETRY_GAP_MS: '60000',
        GDELT_MAX_RETRY_ATTEMPTS: '3',
      },
    });
    log(`sweep finished with status ${run.status}`);
    process.exit(0);
  }
  log(`probe ${attempt}: still limited (${r.why}) — waiting 20m`);
  await sleep(PROBE_INTERVAL_MS);
}

log('gave up after 7h — GDELT never cleared');
