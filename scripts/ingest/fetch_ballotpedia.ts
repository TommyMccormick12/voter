// Fetch Ballotpedia data for one race. Outputs:
//   supabase/seed/raw/ballotpedia/<hash>.json   (cached HTML wrappers)
//   supabase/seed/candidates/<race-id>.partial.json   (merged with later steps)
//
// Usage:
//   npx tsx scripts/ingest/fetch_ballotpedia.ts \
//     --race-slug "U.S._House_New_Jersey_District_7_election,_2026_(Republican_primary)" \
//     --race-id "race-nj-07-r-2026"
//
// Pre-flight check: ensures ≥4 candidates with ≥3 stances each, per the
// plan §2.5 NJ-07 pre-flight criteria.

import '../_env';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  getCandidate,
  getCandidatesForRace,
} from '../../src/lib/api-clients/ballotpedia';
import { CANDIDATE_FIXTURE_DIR, closeBrowser } from '../../src/lib/api-clients/base';

interface Args {
  raceSlug: string;
  raceId: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceSlug = '';
  let raceId = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-slug') raceSlug = args[++i] ?? '';
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
  }
  if (!raceSlug || !raceId) {
    console.error('Usage: --race-slug "..." --race-id "race-nj-07-..."');
    process.exit(1);
  }
  return { raceSlug, raceId };
}

async function main() {
  const { raceSlug, raceId } = parseArgs();
  console.log(`[ballotpedia] fetching race ${raceSlug}`);

  const candidateSlugs = await getCandidatesForRace(raceSlug);
  if (candidateSlugs.length === 0) {
    console.warn(`[ballotpedia] no candidate slugs found on ${raceSlug}`);
  }

  const candidates = [];
  for (const slug of candidateSlugs) {
    try {
      const data = await getCandidate(slug);
      if (data) candidates.push({ slug, ...data });
    } catch (err) {
      console.warn(`[ballotpedia] failed ${slug}:`, err instanceof Error ? err.message : err);
    }
  }

  // Pre-flight: ≥4 candidates with ≥3 key messages each
  const eligible = candidates.filter((c) => c.key_messages.length >= 3);
  console.log(
    `[ballotpedia] ${candidates.length} candidates total, ${eligible.length} with ≥3 key messages`
  );
  if (eligible.length < 4) {
    console.warn(
      `[ballotpedia] ⚠ Pre-flight WARNING: only ${eligible.length}/4 candidates have ≥3 key messages. ` +
        `Consider a different race or supplement with campaign-site scraping.`
    );
  }

  // Merge into the partial fixture (or create one)
  mkdirSync(CANDIDATE_FIXTURE_DIR, { recursive: true });
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  let existing: { race?: unknown; candidates?: unknown[] } = {};
  if (existsSync(partialPath)) {
    existing = JSON.parse(readFileSync(partialPath, 'utf8'));
  }
  const merged = {
    ...existing,
    race: {
      ...(typeof existing.race === 'object' && existing.race !== null ? existing.race : {}),
      id: raceId,
      ballotpedia_race_slug: raceSlug,
    },
    candidates: candidates.map((c) => ({
      // Carry forward any fields already merged in by other ingest scripts
      ...((Array.isArray(existing.candidates) &&
        existing.candidates.find(
          (e) => typeof e === 'object' && e !== null && 'ballotpedia_slug' in e && e.ballotpedia_slug === c.slug
        )) ||
        {}),
      ballotpedia_slug: c.slug,
      name: c.name,
      bio: c.bio,
      party: c.party,
      office: c.office,
      campaign_website: c.campaign_website,
      key_messages: c.key_messages,
      campaign_themes: c.campaign_themes,
      ballotpedia_url: c.ballotpedia_url,
    })),
  };
  writeFileSync(partialPath, JSON.stringify(merged, null, 2));
  console.log(`[ballotpedia] wrote ${partialPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Release the headless Chromium so Node can exit. Without this the
    // browser stays alive in the background until the OS reaps it.
    await closeBrowser();
  });
