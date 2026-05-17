// Populate photo_url for every active candidate that has a bioguide_id.
//
// Source: bioguide.congress.gov hosts the official portrait of every
// current and former member of Congress at:
//   https://bioguide.congress.gov/photo/{BIOGUIDE_ID}.jpg
//
// The older /bioguide/photo/{FIRST_LETTER}/{ID}.jpg pattern still
// 301-redirects but we store the direct URL to avoid the extra hop
// on every page render.
//
// US government work — public domain, no attribution required. Bioguide
// is rock-solid infrastructure; hotlinking is fine.
//
// Bioguide requires a real User-Agent header — bare `curl` and similar
// (including Node fetch's default) get a 403 Forbidden. We send a
// project-identifying UA on every HEAD probe. The browser-side render
// is unaffected (browser UA is always real).
//
// HEAD-check each URL before writing. If a candidate's portrait is
// missing (rare — usually a brand-new member whose photo hasn't been
// taken yet), skip and log. Better to leave photo_url null and fall
// back to initials than to write a URL that 404s in the browser.
//
// Idempotent: re-running the script on the same fixture is a no-op
// if photo_url is already set to the expected bioguide URL.
//
// Non-incumbents and candidates without bioguide_id are skipped silently.
// They get the gradient-initials fallback in the UI.
//
// Usage:
//   npx tsx scripts/ingest/fetch_photos.ts --race-id race-fl-25-d-2026
//   npx tsx scripts/ingest/fetch_photos.ts --all-fl    # every FL fixture

import '../_env';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';

interface Args {
  raceId: string | null;
  allFL: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId: string | null = null;
  let allFL = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? null;
    if (args[i] === '--all-fl') allFL = true;
  }
  if (!raceId && !allFL) {
    console.error('Usage: --race-id "..."  OR  --all-fl');
    process.exit(1);
  }
  return { raceId, allFL };
}

/** Build the canonical bioguide portrait URL for a member. */
export function bioguidePhotoUrl(bioguideId: string): string {
  return `https://bioguide.congress.gov/photo/${bioguideId}.jpg`;
}

const UA =
  'Mozilla/5.0 (compatible; voter-photo-ingest/1.0; +https://ballotmatch.org)';

// Bioguide returns 403 on most HEAD requests (their bot detection treats
// HEAD as suspicious). GET works reliably with a real UA + image Accept.
// We still discard the body — the only thing we care about is the status.
async function imageProbe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'image/*' },
    });
    // Release the socket whether the response is good or bad.
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

async function processRace(raceId: string): Promise<{
  candidates: number;
  withBioguide: number;
  written: number;
  notFound: number;
  alreadySet: number;
}> {
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`  [skip] fixture missing: ${partialPath}`);
    return { candidates: 0, withBioguide: 0, written: 0, notFound: 0, alreadySet: 0 };
  }
  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const candidates = (fixture.candidates ?? []) as Array<Record<string, unknown>>;

  let withBioguide = 0;
  let written = 0;
  let notFound = 0;
  let alreadySet = 0;

  for (const c of candidates) {
    const bioguideId =
      typeof c.bioguide_id === 'string' && c.bioguide_id.trim()
        ? c.bioguide_id.trim()
        : null;
    if (!bioguideId) continue;
    withBioguide++;

    const expected = bioguidePhotoUrl(bioguideId);
    if (c.photo_url === expected) {
      alreadySet++;
      continue;
    }

    const ok = await imageProbe(expected);
    if (!ok) {
      console.warn(`  [404] ${c.slug ?? c.name}: ${expected}`);
      notFound++;
      continue;
    }

    c.photo_url = expected;
    written++;
    console.log(`  [ok] ${c.slug ?? c.name} → ${expected}`);
  }

  if (written > 0) {
    writeFileSync(partialPath, JSON.stringify(fixture, null, 2));
  }

  return { candidates: candidates.length, withBioguide, written, notFound, alreadySet };
}

async function main() {
  const { raceId, allFL } = parseArgs();

  const raceIds: string[] = [];
  if (allFL) {
    for (const f of readdirSync(CANDIDATE_FIXTURE_DIR)) {
      if (/^race-fl-.*-2026\.partial\.json$/.test(f)) {
        raceIds.push(f.replace('.partial.json', ''));
      }
    }
    raceIds.sort();
  } else if (raceId) {
    raceIds.push(raceId);
  }

  const totals = { candidates: 0, withBioguide: 0, written: 0, notFound: 0, alreadySet: 0 };
  for (const id of raceIds) {
    console.log(`\n== ${id} ==`);
    const r = await processRace(id);
    totals.candidates += r.candidates;
    totals.withBioguide += r.withBioguide;
    totals.written += r.written;
    totals.notFound += r.notFound;
    totals.alreadySet += r.alreadySet;
  }

  console.log(
    `\n[fetch_photos] done. ${totals.candidates} candidates across ${raceIds.length} races. ` +
      `${totals.withBioguide} have bioguide_id, ${totals.written} new photos written, ` +
      `${totals.alreadySet} already set, ${totals.notFound} URLs 404'd.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
