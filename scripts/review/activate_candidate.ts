// Mark a single candidate as activation-approved by promoting them out
// of the .partial.json fixture. Operates on local fixtures; the actual
// flip of candidates.active=true happens at seed time when the fixture
// is loaded into Supabase.
//
// Usage:
//   npx tsx scripts/review/activate_candidate.ts \
//     --race-id race-nj-07-r-2026 --slug thomas-kean-jr

import '../_env';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';

interface Args {
  raceId: string;
  slug: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId = '';
  let slug = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
    if (args[i] === '--slug') slug = args[++i] ?? '';
  }
  if (!raceId || !slug) {
    console.error('Usage: --race-id "..." --slug "candidate-slug"');
    process.exit(1);
  }
  return { raceId, slug };
}

function main() {
  const { raceId, slug } = parseArgs();
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`Partial fixture missing: ${partialPath}`);
    process.exit(1);
  }
  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const candidate = fixture.candidates?.find(
    (c: { slug?: string }) => c.slug === slug
  );
  if (!candidate) {
    console.error(`Candidate slug "${slug}" not found in fixture.`);
    process.exit(1);
  }
  candidate.active = true;
  candidate.activated_at = new Date().toISOString();
  writeFileSync(partialPath, JSON.stringify(fixture, null, 2));
  console.log(`[activate] ${candidate.name} marked active in ${partialPath}`);
}

main();
