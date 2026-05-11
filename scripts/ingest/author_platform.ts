// Merge a hand-authored platform JSON into a candidate fixture.
//
// Use case:
//   D-side challengers in low-name-recognition primaries often have no
//   Wikipedia "Political positions" section (FL Senate D, FL-13 D, etc.).
//   The automated platform extractor (scripts/ingest/fetch_platform.ts)
//   correctly skips them, but the synth step then has zero input and
//   the carousel renders empty.
//
//   This helper accepts a small JSON file the user authored by reading
//   the candidate's campaign-site /issues page, and merges its fields
//   into the candidate's row in the .partial.json fixture. After that,
//   the standard `npm run synth:stances` produces top_stances normally
//   — same pipeline, same Zod validation, same citation rules. Hand
//   authoring is just an alternative source of the input data, not a
//   bypass of synthesis.
//
// Author file shape (./authored/<race-id>--<slug>.json):
//   {
//     "slug": "candidate-slug",
//     "bio": "...",                  (optional)
//     "key_messages": ["...", "..."], (1-5 short platform bullets)
//     "campaign_themes": [
//       { "heading": "Economy", "text": "..." }
//     ],
//     "website": "https://..."       (optional — recorded as source for the synth prompt)
//   }
//
// Usage:
//   npx tsx scripts/ingest/author_platform.ts \
//     --race-id race-fl-sen-d-2026 \
//     --file authored/race-fl-sen-d-2026--alexander-vindman.json

import '../_env';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';

interface AuthoredPayload {
  slug: string;
  bio?: string | null;
  key_messages?: string[];
  campaign_themes?: Array<{ heading: string; text: string }>;
  website?: string | null;
}

interface Args {
  raceId: string;
  file: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId = '';
  let file = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
    else if (args[i] === '--file') file = args[++i] ?? '';
  }
  if (!raceId || !file) {
    console.error('Usage: --race-id "..." --file path/to/authored.json');
    process.exit(1);
  }
  return { raceId, file };
}

function validate(payload: AuthoredPayload): string[] {
  const errs: string[] = [];
  if (!payload.slug || typeof payload.slug !== 'string') {
    errs.push('slug is required (string)');
  }
  if (
    (!payload.key_messages || payload.key_messages.length === 0) &&
    (!payload.campaign_themes || payload.campaign_themes.length === 0)
  ) {
    errs.push('At least one of key_messages or campaign_themes is required');
  }
  if (payload.key_messages) {
    if (!Array.isArray(payload.key_messages)) {
      errs.push('key_messages must be an array of strings');
    } else {
      for (const m of payload.key_messages) {
        if (typeof m !== 'string' || m.trim().length < 10) {
          errs.push(`key_messages entries must be strings of at least 10 chars: "${m}"`);
        }
      }
    }
  }
  if (payload.campaign_themes) {
    if (!Array.isArray(payload.campaign_themes)) {
      errs.push('campaign_themes must be an array');
    } else {
      for (const t of payload.campaign_themes) {
        if (!t || typeof t.heading !== 'string' || typeof t.text !== 'string') {
          errs.push('campaign_themes entries must have {heading, text} strings');
        }
      }
    }
  }
  return errs;
}

function main() {
  const { raceId, file } = parseArgs();
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`[author-platform] fixture missing: ${partialPath}`);
    process.exit(1);
  }
  if (!existsSync(file)) {
    console.error(`[author-platform] authored file missing: ${file}`);
    process.exit(1);
  }
  const payload: AuthoredPayload = JSON.parse(readFileSync(file, 'utf8'));
  const errs = validate(payload);
  if (errs.length > 0) {
    console.error('[author-platform] validation failed:');
    for (const e of errs) console.error(`  - ${e}`);
    process.exit(1);
  }

  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const candidate = (fixture.candidates ?? []).find(
    (c: { slug?: string }) => c.slug === payload.slug,
  );
  if (!candidate) {
    console.error(
      `[author-platform] slug "${payload.slug}" not found in fixture. ` +
        `Make sure the candidate row exists (run ingest:fec first if seeding fresh).`,
    );
    process.exit(1);
  }

  // Merge — don't clobber other fields the pipeline already wrote.
  if (payload.bio) candidate.bio = payload.bio;
  if (payload.website) candidate.website = payload.website;
  if (payload.key_messages) {
    // Dedupe with anything already present (e.g. Ballotpedia stub).
    const existing: string[] = Array.isArray(candidate.key_messages)
      ? candidate.key_messages
      : [];
    const merged = Array.from(new Set([...existing, ...payload.key_messages]));
    candidate.key_messages = merged;
  }
  if (payload.campaign_themes) {
    const existing: Array<{ heading: string; text: string }> = Array.isArray(
      candidate.campaign_themes,
    )
      ? candidate.campaign_themes
      : [];
    // Dedupe by heading
    const byHeading = new Map<string, { heading: string; text: string }>();
    for (const t of existing) byHeading.set(t.heading, t);
    for (const t of payload.campaign_themes) byHeading.set(t.heading, t);
    candidate.campaign_themes = Array.from(byHeading.values());
  }
  candidate.platform_source = 'hand_authored';
  candidate.platform_authored_at = new Date().toISOString();

  writeFileSync(partialPath, JSON.stringify(fixture, null, 2));
  console.log(
    `[author-platform] merged ${payload.key_messages?.length ?? 0} key_messages + ${
      payload.campaign_themes?.length ?? 0
    } themes into ${candidate.name} (${candidate.slug}) → ${partialPath}`,
  );
  console.log(`[author-platform] next: npm run synth:stances -- --race-id ${raceId}`);
}

main();
