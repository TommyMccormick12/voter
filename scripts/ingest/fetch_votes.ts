// Fetch congressional voting records for incumbent candidates only.
// Non-incumbents have no record (use statements instead).
//
// Source: GovTrack API (keyless, replaced ProPublica which sunset in 2023).
// See src/lib/api-clients/govtrack.ts for the client.
//
// Usage:
//   npx tsx scripts/ingest/fetch_votes.ts \
//     --race-id race-fl-10-r-2026 --state FL --chamber house
//
// Caching: every API response is cached to supabase/seed/raw/www.govtrack.us/
// via fetchCached, so re-runs are free.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  findMember,
  getMemberVotes,
  getVoteDetail,
  normalizeVotePosition,
  billIdFromRelated,
} from '../../src/lib/api-clients/govtrack';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';

const VOTES_PER_CANDIDATE = 50;

interface Args {
  raceId: string;
  state: string;
  chamber: 'house' | 'senate';
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId = '';
  let state = '';
  let chamber: 'house' | 'senate' = 'house';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
    if (args[i] === '--state') state = args[++i] ?? '';
    if (args[i] === '--chamber') chamber = (args[++i] ?? 'house') as 'house' | 'senate';
  }
  if (!raceId || !state) {
    console.error('Usage: --race-id "..." --state FL [--chamber house|senate]');
    process.exit(1);
  }
  return { raceId, state, chamber };
}

// Heuristic bill-title → issue slug mapping. Same regex set as the prior
// ProPublica script; deliberately conservative — better to miss a tag
// than to mis-tag, since these feed Haiku synthesis.
function inferIssues(billTitle: string, billSummary: string | null): string[] {
  const text = `${billTitle} ${billSummary ?? ''}`.toLowerCase();
  const issues: string[] = [];
  const map: Array<[RegExp, string]> = [
    [/tax|jobs and economic|economy|wage/, 'economy'],
    [/health|medicare|medicaid|aca|prescription/, 'healthcare'],
    [/immigration|border|asylum|deport/, 'immigration'],
    [/climate|emission|clean energy|epa|fossil/, 'climate'],
    [/education|student loan|school|teacher/, 'education'],
    [/firearm|gun|second amendment/, 'guns'],
    [/criminal justice|prison|sentencing|police/, 'criminal_justice'],
    [/foreign|ukraine|israel|china|nato|military|defense/, 'foreign_policy'],
    [/tax cut|tcja/, 'taxes'],
    [/housing|rent|mortgage|hud/, 'housing'],
  ];
  for (const [re, slug] of map) {
    if (re.test(text)) issues.push(slug);
  }
  return issues;
}

async function main() {
  const { raceId, state, chamber } = parseArgs();
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`Partial fixture missing: ${partialPath}. Run fetch_ballotpedia first.`);
    process.exit(1);
  }
  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const candidates: Array<Record<string, unknown> & { name?: string }> =
    fixture.candidates ?? [];

  for (const c of candidates) {
    if (!c.name || typeof c.name !== 'string') continue;
    const match = await findMember(c.name, state, chamber);
    if (!match) {
      console.log(`[votes] no member match for ${c.name} (challenger or wrong chamber)`);
      c.incumbent = false;
      c.voting_record = [];
      continue;
    }
    console.log(
      `[votes] ${c.name} → govtrack=${match.govtrack_id} bioguide=${match.bioguide_id}`,
    );
    c.incumbent = true;
    c.govtrack_id = match.govtrack_id;
    c.bioguide_id = match.bioguide_id;

    const voteRows = await getMemberVotes(match.govtrack_id, VOTES_PER_CANDIDATE);
    const enriched: Array<Record<string, unknown>> = [];

    for (const row of voteRows) {
      const detail = await getVoteDetail(row.option.vote);
      if (!detail) continue;

      // Skip procedural votes with no bill attached — they're noise in the
      // record and the synthesis step doesn't get useful signal from them.
      const billId = billIdFromRelated(detail.related_bill);
      if (!billId && detail.category === 'procedural') continue;

      const title = detail.related_bill?.title ?? detail.question;
      const summary = detail.related_bill?.current_status_description ?? null;

      enriched.push({
        bill_id: billId ?? `vote-${detail.id}`,
        bill_title: title,
        bill_summary: summary,
        vote: normalizeVotePosition(row.option.value),
        issue_slugs: inferIssues(title, summary),
        vote_date: row.created.slice(0, 10), // ISO datetime → YYYY-MM-DD
        source: 'govtrack',
        source_url: detail.link,
        significance: detail.category === 'procedural' ? 'procedural' : 'major',
      });
    }

    c.voting_record = enriched;
    console.log(`[votes] ${c.name}: ${enriched.length} votes captured`);
  }

  writeFileSync(partialPath, JSON.stringify(fixture, null, 2));
  console.log(`[votes] wrote ${partialPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
