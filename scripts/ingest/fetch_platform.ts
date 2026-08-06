// Pull a candidate's stated policy positions from Wikipedia (where
// available), extract structured positions via Haiku, and populate
// bio + campaign_website + key_messages + campaign_themes on the
// fixture so synth:stances has the "stated platform" input it needs.
//
// Replaces the data Ballotpedia used to provide (Ballotpedia's 2026
// federal coverage is too thin this early in the cycle — see /scripts/README.md).
//
// WIKIDATA GATE (Spec B1.2 / Ticket T09): every candidate must clear
// resolveCandidacyQid() before any Wikipedia page read. A name-search
// "first hit wins" path is not reachable from this file — the FL-11
// "Daniel Webster" fixture inherited the bio of the 1782-1852 statesman
// because the old code guessed a page title from the name and took the
// first result. See DATA-AUDIT-2026-08-06.md root cause 3.2.
//
// Usage:
//   ANTHROPIC_API_KEY=... npx tsx scripts/ingest/fetch_platform.ts \
//     --race-id race-fl-10-d-2026

import '../_env';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getWikipediaCandidate } from '../../src/lib/api-clients/wikipedia';
import { resolveCandidacyQid } from '../../src/lib/api-clients/wikidata';
import { stripTitles } from '../../src/lib/api-clients/names';
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

const SUPPORTED_OFFICES = new Set(['U.S. House', 'U.S. Senate']);

function isSupportedOffice(value: unknown): value is 'U.S. House' | 'U.S. Senate' {
  return typeof value === 'string' && SUPPORTED_OFFICES.has(value);
}

export interface PlatformCandidate {
  name: string;
  office: 'U.S. House' | 'U.S. Senate';
  state: string;
  district: string | null;
  bio?: string;
  campaign_website?: string;
  key_messages?: string[];
  campaign_themes?: Array<{ heading: string; text: string }>;
  platform_excerpts?: Array<{
    issue_slug: string;
    excerpt: string;
    source: string;
    source_url: string;
  }>;
}

/**
 * Wikidata-gated platform fetch for one candidate. Mutates `c` in place
 * (bio, campaign_website, key_messages, campaign_themes, platform_excerpts)
 * on success. On a gate miss or an empty extraction, logs and returns
 * without touching Wikipedia at all.
 */
export async function fetchPlatformForCandidate(
  c: PlatformCandidate,
  cycle: number,
): Promise<void> {
  const gate = await resolveCandidacyQid({
    name: stripTitles(c.name),
    office: c.office,
    state: c.state,
    district: c.district,
    cycle,
  });

  if (gate.gated) {
    console.log(`[platform] ${c.name}: Wikidata gate — ${gate.reason}`);
    return;
  }

  if (!gate.enwikiTitle) {
    console.log(
      `[platform] ${c.name}: Wikidata QID ${gate.qid} verified but has no English Wikipedia sitelink — skipping`,
    );
    return;
  }

  const wiki = await getWikipediaCandidate(gate.enwikiTitle);
  if (!wiki.found) {
    console.log(
      `[platform] ${c.name}: Wikidata QID ${gate.qid} verified (via ${gate.matchedVia}) but its Wikipedia page "${gate.enwikiTitle}" did not resolve`,
    );
    return;
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
    return;
  }

  const result = await extractPlatform(c.name, wiki.political_positions_text);
  if (result.positions.length === 0) {
    console.log(`[platform] ${c.name}: Wikipedia parsed but Haiku extracted 0 positions`);
    return;
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

  const callType =
    result.source === 'cache'
      ? '(cached)'
      : `(Haiku ${result.input_tokens ?? 0}/${result.output_tokens ?? 0} tok)`;
  console.log(
    `[platform] ${c.name}: ${result.positions.length} positions extracted via Wikidata-gated Wikipedia (QID ${gate.qid}, matched ${gate.matchedVia}) ${callType}`,
  );
  const issues = result.positions.map((p) => p.issue_slug).join(', ');
  console.log(`            issues: ${issues}`);
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
  const cycle = Number(fixture.race?.cycle ?? 2026);

  for (const c of candidates) {
    if (!c.name || typeof c.name !== 'string') continue;
    if (!isSupportedOffice(c.office)) {
      console.log(
        `[platform] ${c.name}: unsupported office "${String(c.office)}" — Wikidata gate needs office to be "U.S. House" or "U.S. Senate", skipping`,
      );
      continue;
    }
    await fetchPlatformForCandidate(c as unknown as PlatformCandidate, cycle);
  }

  writeFileSync(partialPath, JSON.stringify(fixture, null, 2));
  console.log(`[platform] wrote ${partialPath}`);
}

// Only run when invoked directly (`npx tsx scripts/ingest/fetch_platform.ts`),
// not when imported by tests.
const isMainModule =
  typeof process.argv[1] === 'string' && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
