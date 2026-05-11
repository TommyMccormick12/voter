// Pull a candidate's stated policy positions from Wikipedia (where
// available), extract structured positions via Haiku, and populate
// bio + campaign_website + key_messages + campaign_themes on the
// fixture so synth:stances has the "stated platform" input it needs.
//
// Replaces the data Ballotpedia used to provide (Ballotpedia's 2026
// federal coverage is too thin this early in the cycle — see /scripts/README.md).
//
// Usage:
//   ANTHROPIC_API_KEY=... npx tsx scripts/ingest/fetch_platform.ts \
//     --race-id race-fl-10-d-2026

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getWikipediaCandidate } from '../../src/lib/api-clients/wikipedia';
import { extractPlatform } from '../../src/lib/llm/extract-platform';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';

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

async function main() {
  const { raceId } = parseArgs();
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`Partial fixture missing: ${partialPath}. Run fetch_fec (or fetch_ballotpedia) first.`);
    process.exit(1);
  }

  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const candidates: Array<Record<string, unknown> & { name?: string }> =
    fixture.candidates ?? [];

  for (const c of candidates) {
    if (!c.name || typeof c.name !== 'string') continue;

    // Normalize name for Wikipedia lookup: "Maxwell Alejandro Frost" → try
    // "Maxwell Frost" first (Wikipedia tends to use shorter common names).
    // Fall back to the full name if the short version 404s.
    const parts = c.name.trim().split(/\s+/);
    const candidates_to_try = parts.length >= 3
      ? [`${parts[0]} ${parts[parts.length - 1]}`, c.name]
      : [c.name];

    let wiki = await getWikipediaCandidate(candidates_to_try[0]);
    if (!wiki.found && candidates_to_try.length > 1) {
      wiki = await getWikipediaCandidate(candidates_to_try[1]);
    }

    if (!wiki.found) {
      console.log(`[platform] ${c.name}: no Wikipedia page — skipping`);
      continue;
    }

    // Bio + website fill: only set if not already populated by an earlier
    // step (Ballotpedia would have first-write priority if it had data).
    if (!c.bio && wiki.lead_paragraph) {
      c.bio = wiki.lead_paragraph;
    }
    if (!c.campaign_website && wiki.website) {
      c.campaign_website = wiki.website;
    }

    if (!wiki.political_positions_text) {
      console.log(`[platform] ${c.name}: Wikipedia page found but no "Political positions" section`);
      continue;
    }

    const result = await extractPlatform(c.name, wiki.political_positions_text);
    if (result.positions.length === 0) {
      console.log(`[platform] ${c.name}: Wikipedia parsed but Haiku extracted 0 positions`);
      continue;
    }

    // Write to fixture in the schema synth:stances already reads.
    // key_messages: short summaries (the "What they say" data)
    // campaign_themes: structured per-issue with quoted source
    c.key_messages = result.positions.map((p) => p.summary);
    c.campaign_themes = result.positions.map((p) => ({
      heading: p.issue_slug,
      text: p.summary,
    }));
    // Preserve the per-issue quote provenance for review docs
    c.platform_excerpts = result.positions.map((p) => ({
      issue_slug: p.issue_slug,
      excerpt: p.source_excerpt,
      source: 'wikipedia',
      source_url: wiki.url,
    }));

    const callType = result.source === 'cache' ? '(cached)' : `(Haiku ${result.input_tokens ?? 0}/${result.output_tokens ?? 0} tok)`;
    console.log(
      `[platform] ${c.name}: ${result.positions.length} positions extracted from Wikipedia ${callType}`,
    );
    const issues = result.positions.map((p) => p.issue_slug).join(', ');
    console.log(`            issues: ${issues}`);
  }

  writeFileSync(partialPath, JSON.stringify(fixture, null, 2));
  console.log(`[platform] wrote ${partialPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
