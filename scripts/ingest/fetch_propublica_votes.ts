// Fetch ProPublica voting record for incumbent candidates only.
// Non-incumbents have no congressional voting history (use statements instead).
//
// Usage:
//   PROPUBLICA_API_KEY=... npx tsx scripts/ingest/fetch_propublica_votes.ts \
//     --race-id race-nj-07-r-2026 --state NJ --chamber house

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  findMemberId,
  getMemberVotes,
  getBill,
} from '../../src/lib/api-clients/propublica';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';

const VOTES_PER_CANDIDATE = 50;

interface Args {
  raceId: string;
  state: string;
  chamber: 'house' | 'senate';
  congress: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId = '';
  let state = '';
  let chamber: 'house' | 'senate' = 'house';
  let congress = 119;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
    if (args[i] === '--state') state = args[++i] ?? '';
    if (args[i] === '--chamber') chamber = (args[++i] ?? 'house') as 'house' | 'senate';
    if (args[i] === '--congress') congress = parseInt(args[++i] ?? '', 10);
  }
  if (!raceId || !state) {
    console.error('Usage: --race-id "..." --state NJ [--chamber house|senate] [--congress 119]');
    process.exit(1);
  }
  return { raceId, state, chamber, congress };
}

// Heuristic mapping of bill titles → issue slugs. Real implementation
// would use ProPublica's "primary_subject" field via getBill().
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
  const { raceId, state, chamber, congress } = parseArgs();
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`Partial fixture missing: ${partialPath}`);
    process.exit(1);
  }
  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const candidates: Array<Record<string, unknown> & { name?: string }> =
    fixture.candidates ?? [];

  for (const c of candidates) {
    if (!c.name || typeof c.name !== 'string') continue;
    const memberId = await findMemberId(c.name, state, chamber, congress);
    if (!memberId) {
      console.log(`[propublica] no member match for ${c.name} (challenger or wrong chamber)`);
      c.incumbent = false;
      c.voting_record = [];
      continue;
    }
    console.log(`[propublica] ${c.name} → member_id=${memberId}`);
    c.incumbent = true;
    c.propublica_member_id = memberId;

    const votes = await getMemberVotes(memberId, 0);
    const recentMajor = votes
      .filter(
        (v) => v.bill && v.bill.bill_id && v.position !== 'Not Voting'
      )
      .slice(0, VOTES_PER_CANDIDATE);

    const enriched = [];
    for (const v of recentMajor) {
      const billDetail = v.bill.bill_id ? await getBill(v.bill.bill_id, congress) : null;
      const summary = billDetail?.summary_short ?? billDetail?.summary ?? null;
      enriched.push({
        bill_id: v.bill.bill_id,
        bill_title: v.bill.title ?? v.description ?? 'Untitled',
        bill_summary: summary,
        vote: voteLabel(v.position),
        issue_slugs: inferIssues(v.bill.title ?? v.description ?? '', summary),
        vote_date: v.date,
        source: 'propublica',
        source_url: v.vote_uri,
        significance: 'major',
      });
    }
    c.voting_record = enriched;
    console.log(`[propublica] ${c.name}: ${enriched.length} votes captured`);
  }

  writeFileSync(partialPath, JSON.stringify(fixture, null, 2));
  console.log(`[propublica] wrote ${partialPath}`);
}

function voteLabel(position: string): string {
  const map: Record<string, string> = {
    Yes: 'yea',
    No: 'nay',
    Present: 'present',
    'Not Voting': 'absent',
  };
  return map[position] ?? 'no_vote';
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
