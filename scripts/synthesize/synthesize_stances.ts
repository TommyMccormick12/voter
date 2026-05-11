// Run Haiku synthesis on every candidate in a race fixture.
// Writes top_stances back into the partial fixture.
//
// Usage:
//   ANTHROPIC_API_KEY=... npx tsx scripts/synthesize/synthesize_stances.ts \
//     --race-id race-nj-07-r-2026

import '../_env';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { synthesizeStances, type CandidateRawData } from '../../src/lib/llm/curate';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';

interface Args {
  raceId: string;
  /** If passed, only synthesize for the candidate with this slug */
  onlySlug?: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId = '';
  let onlySlug: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
    if (args[i] === '--only-slug') onlySlug = args[++i] ?? '';
  }
  if (!raceId) {
    console.error('Usage: --race-id "..." [--only-slug ballotpedia_slug]');
    process.exit(1);
  }
  return { raceId, onlySlug };
}

async function main() {
  const { raceId, onlySlug } = parseArgs();
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`Partial fixture missing: ${partialPath}`);
    process.exit(1);
  }
  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const candidates: Array<Record<string, unknown> & { name?: string; slug?: string; ballotpedia_slug?: string }> =
    fixture.candidates ?? [];

  let totalInTokens = 0;
  let totalOutTokens = 0;
  let synthesized = 0;

  for (const c of candidates) {
    if (onlySlug && c.ballotpedia_slug !== onlySlug) continue;
    if (!c.name) continue;

    // Build the slug used for stance_id stability — prefer an explicit slug
    // field, otherwise derive from name.
    const slug = (c.slug as string) ?? slugify(c.name);
    c.slug = slug;

    const rawData: CandidateRawData = {
      slug,
      name: c.name,
      party: (c.party as string) ?? '',
      bio: (c.bio as string) ?? null,
      key_messages: (c.key_messages as string[]) ?? [],
      campaign_themes:
        (c.campaign_themes as Array<{ heading: string; text: string }>) ?? [],
      voting_record:
        (c.voting_record as CandidateRawData['voting_record']) ?? [],
      statements: (c.statements as CandidateRawData['statements']) ?? [],
      top_industries:
        (c.top_industries as CandidateRawData['top_industries']) ?? [],
    };

    if (
      rawData.key_messages.length === 0 &&
      rawData.voting_record.length === 0 &&
      rawData.statements.length === 0
    ) {
      console.log(`[synthesize] skipping ${c.name} — no source data`);
      continue;
    }

    console.log(`[synthesize] ${c.name}`);
    try {
      const result = await synthesizeStances(rawData);
      // Attach source_url from the candidate's website where available
      const website = (c.campaign_website as string) ?? (c.ballotpedia_url as string) ?? '';
      c.top_stances = result.top_stances.map((s) => ({
        ...s,
        source_url: s.source_url || website,
      }));
      totalInTokens += result.input_tokens;
      totalOutTokens += result.output_tokens;
      synthesized += 1;
      console.log(
        `[synthesize] ${c.name}: ${result.top_stances.length} stances, ${result.input_tokens}/${result.output_tokens} tokens`
      );
    } catch (err) {
      console.error(
        `[synthesize] ${c.name} failed:`,
        err instanceof Error ? err.message : err
      );
      c.top_stances = c.top_stances ?? [];
    }
  }

  writeFileSync(partialPath, JSON.stringify(fixture, null, 2));
  console.log(
    `[synthesize] done. ${synthesized} candidates, ${totalInTokens} in / ${totalOutTokens} out tokens`
  );
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
