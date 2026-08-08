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
import { selectForSynthesis, effectiveSlug } from './candidate-selection';

interface Args {
  raceId: string;
  /** If passed, only synthesize for the candidate carrying this slug */
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
    console.error('Usage: --race-id "..." [--only-slug candidate-slug]');
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
  const candidates: Array<Record<string, unknown> & { name?: string; slug?: string }> =
    fixture.candidates ?? [];

  // Selection is separated from synthesis so an unmatched --only-slug fails
  // before a single token is spent, and fails loudly rather than reporting a
  // successful run that touched nobody.
  let selected: typeof candidates;
  try {
    selected = selectForSynthesis(candidates, onlySlug).selected;
  } catch (err) {
    console.error(`[synthesize] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  if (onlySlug) {
    console.log(`[synthesize] targeting ${selected.length} candidate: ${onlySlug}`);
  }

  let totalInTokens = 0;
  let totalOutTokens = 0;
  let synthesized = 0;

  for (const c of selected) {
    if (!c.name) continue;

    // The slug used for stance_id stability — the same value selection
    // matched on, so the flag and the fixture cannot disagree.
    const slug = effectiveSlug(c);
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
      // `website` is in this list because author_platform.ts writes the
      // hand-authored campaign URL to that field, not campaign_website.
      // Without it, every candidate sourced through the authored path —
      // the only route open to challengers with no Wikidata record — got
      // stances a voter cannot click through and check.
      const website =
        (c.campaign_website as string) ??
        (c.website as string) ??
        (c.ballotpedia_url as string) ??
        '';
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
