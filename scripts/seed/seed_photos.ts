// Surgically update photo_url on existing candidate rows.
//
// Why this exists separate from seed_candidates.ts:
// seed_candidates.ts does a full upsert (overwrites top_stances,
// voting_record, donors, industries, statements). Some fixtures have
// drifted from production state — e.g., re-running the ingest pipeline
// can produce thinner top_stances for incumbents whose Wikipedia pages
// changed structure. Running the full seed would regress those rows.
//
// This script ONLY updates photo_url. It runs:
//   UPDATE candidates SET photo_url = $1 WHERE slug = $2
// for each candidate in the fixture that (a) is marked active, (b) has
// a non-null photo_url, and (c) currently has a different value in DB
// (or null).
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed/seed_photos.ts --all-fl
//   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed/seed_photos.ts --race-id race-fl-25-d-2026

import '../_env';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';
import { getAdminClient } from './supabase-admin';

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

async function main() {
  const { raceId, allFL } = parseArgs();
  const supabase = getAdminClient();

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

  let updated = 0;
  let skipped = 0;
  let unchanged = 0;
  let missing = 0;

  for (const id of raceIds) {
    const partialPath = join(CANDIDATE_FIXTURE_DIR, `${id}.partial.json`);
    if (!existsSync(partialPath)) continue;
    const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
    const candidates = (fixture.candidates ?? []) as Array<
      Record<string, unknown>
    >;

    for (const c of candidates) {
      const slug = typeof c.slug === 'string' ? c.slug : null;
      const photoUrl =
        typeof c.photo_url === 'string' && c.photo_url.trim()
          ? c.photo_url.trim()
          : null;

      if (!slug) continue;
      // Only seed photos for active candidates. The fixture may have
      // photo_url populated for inactive candidates (we ingest broadly
      // from bioguide), but only active ones have rows in DB to update.
      if (c.active !== true) {
        skipped++;
        continue;
      }
      if (!photoUrl) {
        skipped++;
        continue;
      }

      // Read current value first so we can report "no change" cleanly
      // and avoid unnecessary writes (Supabase logs every UPDATE).
      const { data: existing, error: readErr } = await supabase
        .from('candidates')
        .select('photo_url')
        .eq('slug', slug)
        .maybeSingle();

      if (readErr) {
        console.warn(`[seed_photos] read failed for ${slug}: ${readErr.message}`);
        continue;
      }
      if (!existing) {
        console.warn(
          `[seed_photos] ${slug}: not in DB (fixture active but never seeded?)`,
        );
        missing++;
        continue;
      }
      if (existing.photo_url === photoUrl) {
        unchanged++;
        continue;
      }

      const { error: writeErr } = await supabase
        .from('candidates')
        .update({ photo_url: photoUrl })
        .eq('slug', slug);

      if (writeErr) {
        console.error(`[seed_photos] ${slug}: update failed — ${writeErr.message}`);
        continue;
      }

      console.log(`[seed_photos] ${slug} ← ${photoUrl}`);
      updated++;
    }
  }

  console.log(
    `\n[seed_photos] done. ${updated} updated, ${unchanged} unchanged, ${skipped} skipped (inactive or no photo), ${missing} active-but-not-in-DB.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
