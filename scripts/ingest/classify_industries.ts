// Classify a candidate's top contributors into industry buckets via Haiku.
//
// Replaces what OpenSecrets used to do automatically — OpenSecrets retired
// their API. We pull FEC's itemized Schedule A contributions and have Haiku
// bucket them into industries. ~$0.007 per candidate.
//
// Usage:
//   ANTHROPIC_API_KEY=... FEC_API_KEY=... npx tsx scripts/ingest/classify_industries.ts \
//     --race-id race-fl-10-r-2026 --cycle 2026
//
// Prerequisites:
//   - fetch_ballotpedia (gives candidate list)
//   - fetch_fec (gives fec_candidate_id per candidate)
//
// Writes to partial fixture:
//   candidate.top_industries: [{industry_name, amount, rank, cycle, data_source: 'fec+haiku'}]
//   candidate.top_donors:     [{donor_name, donor_type, industry, amount_total, ...}]

import '../_env';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  getCommitteesForCandidate,
  getItemizedContributions,
  type FecContribution,
} from '../../src/lib/api-clients/fec';
import { classifyIndustries, type ContributorInput } from '../../src/lib/llm/classify-industries';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';

const CONTRIBUTIONS_PER_CANDIDATE = 100;

interface Args {
  raceId: string;
  cycle: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId = '';
  let cycle = 2026;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
    if (args[i] === '--cycle') cycle = Number.parseInt(args[++i] ?? '2026', 10);
  }
  if (!raceId) {
    console.error('Usage: --race-id "..." [--cycle 2026]');
    process.exit(1);
  }
  return { raceId, cycle };
}

/**
 * Group itemized contributions by (employer, occupation) so we don't waste
 * Haiku tokens classifying the same employer string 30 times. The classifier
 * sees each distinct employer once with the summed amount.
 */
function aggregateByEmployer(contributions: FecContribution[]): {
  contributors: ContributorInput[];
  byKey: Map<string, FecContribution[]>;
} {
  const byKey = new Map<string, FecContribution[]>();
  for (const c of contributions) {
    const employer = (c.contributor_employer ?? '').trim();
    const occupation = (c.contributor_occupation ?? '').trim();
    const key = `${employer.toLowerCase()}|${occupation.toLowerCase()}`;
    const arr = byKey.get(key) ?? [];
    arr.push(c);
    byKey.set(key, arr);
  }
  const contributors: ContributorInput[] = Array.from(byKey.entries()).map(([, rows]) => ({
    employer: (rows[0].contributor_employer ?? '').trim(),
    occupation: (rows[0].contributor_occupation ?? '').trim(),
    amount: rows.reduce((sum, r) => sum + (r.contribution_receipt_amount ?? 0), 0),
    contributor_count: rows.length,
  }));
  // Sort by amount desc so the most-impactful employers come first (helps if
  // Haiku rate-limits or we ever want to truncate).
  contributors.sort((a, b) => b.amount - a.amount);
  return { contributors, byKey };
}

async function main() {
  const { raceId, cycle } = parseArgs();
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`Partial fixture missing: ${partialPath}. Run fetch_ballotpedia + fetch_fec first.`);
    process.exit(1);
  }
  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const candidates: Array<Record<string, unknown> & { name?: string; fec_candidate_id?: string }> =
    fixture.candidates ?? [];

  for (const c of candidates) {
    if (!c.name) continue;
    if (!c.fec_candidate_id) {
      console.log(`[industries] ${c.name}: no fec_candidate_id (run fetch_fec first) — skipping`);
      c.top_industries = [];
      c.top_donors = [];
      continue;
    }

    // 1. Find the candidate's principal campaign committee
    const committees = await getCommitteesForCandidate(c.fec_candidate_id, cycle);
    const principal = committees.find((cm) => cm.designation === 'P') ?? committees[0];
    if (!principal) {
      console.log(`[industries] ${c.name}: no FEC committee — skipping`);
      c.top_industries = [];
      c.top_donors = [];
      continue;
    }

    // 2. Pull top itemized contributions (>$200, individuals only)
    const contributions = await getItemizedContributions(
      principal.committee_id,
      cycle,
      CONTRIBUTIONS_PER_CANDIDATE,
    );
    if (contributions.length === 0) {
      console.log(`[industries] ${c.name}: no itemized contributions found`);
      c.top_industries = [];
      c.top_donors = [];
      continue;
    }

    // 3. Group by employer+occupation so we classify each unique employer once
    const { contributors } = aggregateByEmployer(contributions);

    // 4. Classify via Haiku
    let result;
    try {
      result = await classifyIndustries(contributors);
    } catch (err) {
      console.error(
        `[industries] ${c.name}: Haiku classification failed —`,
        err instanceof Error ? err.message : err,
      );
      c.top_industries = [];
      c.top_donors = [];
      continue;
    }

    // 5. Write back to fixture in the existing top_industries / top_donors shape
    c.top_industries = result.industries.slice(0, 10).map((row) => ({
      industry_name: row.industry,
      amount: row.amount,
      rank: row.rank,
      cycle,
      data_source: 'fec+haiku',
    }));

    // Top 10 individual donors with their classified industry, ordered by amount.
    c.top_donors = contributions.slice(0, 10).map((row, i) => {
      const employerKey = (row.contributor_employer ?? '').trim();
      const occupationKey = (row.contributor_occupation ?? '').trim();
      const classification = result.classifications.find(
        (cl) => cl.employer === employerKey && cl.occupation === occupationKey,
      );
      return {
        donor_name: row.contributor_name,
        donor_type: 'individual',
        industry: classification?.industry ?? 'Other',
        amount_total: row.contribution_receipt_amount,
        cycle,
        rank_in_candidate: i + 1,
        fec_committee_id: principal.committee_id,
        data_source: 'fec',
      };
    });

    const callType = result.source === 'cache' ? '(cached)' : `(Haiku ~${result.input_tokens ?? 0}/${result.output_tokens ?? 0} tok)`;
    console.log(
      `[industries] ${c.name}: ${contributions.length} contributions → ${result.industries.length} industries ${callType}`,
    );
    if (result.industries.length > 0) {
      const top3 = result.industries.slice(0, 3).map((i) => `${i.industry} ($${Math.round(i.amount).toLocaleString()})`).join(', ');
      console.log(`            top: ${top3}`);
    }
  }

  writeFileSync(partialPath, JSON.stringify(fixture, null, 2));
  console.log(`[industries] wrote ${partialPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
