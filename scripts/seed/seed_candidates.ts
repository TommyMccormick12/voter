// Insert candidate rows + their stances/donors/industries/votes/statements
// from a race fixture into Supabase. Idempotent via upserts on stable IDs.
//
// Only inserts candidates marked active=true (gated by activate_candidate.ts).
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed/seed_candidates.ts \
//     --race-id race-nj-07-r-2026

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';
import { getAdminClient } from './supabase-admin';

interface Args {
  raceId: string;
  /** If true, also insert non-activated candidates (use with caution) */
  includeUnreviewed: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId = '';
  let includeUnreviewed = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
    if (args[i] === '--include-unreviewed') includeUnreviewed = true;
  }
  if (!raceId) {
    console.error('Usage: --race-id "..." [--include-unreviewed]');
    process.exit(1);
  }
  return { raceId, includeUnreviewed };
}

async function main() {
  const { raceId, includeUnreviewed } = parseArgs();
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`Fixture missing: ${partialPath}`);
    process.exit(1);
  }
  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const supabase = getAdminClient();

  const candidates = (fixture.candidates ?? []) as Array<Record<string, unknown>>;
  const eligible = candidates.filter(
    (c) => includeUnreviewed || c.active === true
  );

  if (eligible.length === 0) {
    console.log(
      '[seed-candidates] no candidates eligible. Run activate_candidate.ts on each one first, or pass --include-unreviewed.'
    );
    return;
  }

  for (const c of eligible) {
    const slug = c.slug as string;
    if (!slug) {
      console.warn(`[seed-candidates] skipping candidate without slug:`, c.name);
      continue;
    }

    // 1. Upsert candidate
    const candidateRow = {
      id: c.id ?? `cand-${slug}`,
      slug,
      name: c.name as string,
      party: (c.party as string) ?? null,
      primary_party: (c.party as string)?.charAt(0).toUpperCase() ?? null,
      state: fixture.race.state,
      district: fixture.race.district ?? null,
      race_id: fixture.race.id,
      office: fixture.race.office,
      photo_url: (c.photo_url as string) ?? null,
      bio: (c.bio as string) ?? null,
      website: (c.campaign_website as string) ?? null,
      active: true,
      incumbent: (c.incumbent as boolean) ?? false,
      total_raised: (c.total_raised as number) ?? null,
      top_stances: c.top_stances ?? [],
    };

    const { error: candErr } = await supabase
      .from('candidates')
      .upsert(candidateRow, { onConflict: 'slug' });
    if (candErr) {
      console.error(`[seed-candidates] ${slug} upsert failed:`, candErr.message);
      continue;
    }

    const candId = candidateRow.id;
    console.log(`[seed-candidates] upserted ${slug}`);

    // 2. Replace donors (delete + insert; donors don't have stable PKs from
    //    raw data, so we rebuild every seed)
    await supabase.from('candidate_donors').delete().eq('candidate_id', candId);
    if (Array.isArray(c.donors) && c.donors.length > 0) {
      const donorRows = (c.donors as Array<Record<string, unknown>>).map((d) => ({
        candidate_id: candId,
        donor_name: d.donor_name,
        donor_type: d.donor_type ?? null,
        industry: d.industry ?? null,
        amount_total: d.amount_total,
        cycle: d.cycle ?? fixture.race.cycle,
        fec_committee_id: d.fec_committee_id ?? null,
        data_source: d.data_source ?? 'opensecrets',
        rank_in_candidate: d.rank_in_candidate ?? null,
      }));
      const { error } = await supabase.from('candidate_donors').insert(donorRows);
      if (error) console.warn(`  donors insert: ${error.message}`);
    }

    // 3. Replace top industries
    await supabase
      .from('candidate_top_industries')
      .delete()
      .eq('candidate_id', candId);
    if (Array.isArray(c.top_industries) && c.top_industries.length > 0) {
      const indRows = (c.top_industries as Array<Record<string, unknown>>).map(
        (i) => ({
          candidate_id: candId,
          industry_name: i.industry_name,
          industry_code: i.industry_code ?? null,
          amount: i.amount,
          rank: i.rank,
          cycle: i.cycle ?? fixture.race.cycle,
          data_source: i.data_source ?? 'opensecrets',
        })
      );
      const { error } = await supabase
        .from('candidate_top_industries')
        .insert(indRows);
      if (error) console.warn(`  industries insert: ${error.message}`);
    }

    // 4. Replace voting record
    await supabase
      .from('candidate_voting_record')
      .delete()
      .eq('candidate_id', candId);
    if (Array.isArray(c.voting_record) && c.voting_record.length > 0) {
      const voteRows = (c.voting_record as Array<Record<string, unknown>>).map(
        (v) => ({
          candidate_id: candId,
          bill_id: v.bill_id,
          bill_title: v.bill_title,
          bill_summary: v.bill_summary ?? null,
          vote: v.vote,
          issue_slugs: v.issue_slugs ?? [],
          vote_date: v.vote_date,
          source: v.source ?? 'govtrack',
          source_url: v.source_url ?? null,
          significance: v.significance ?? 'major',
        })
      );
      const { error } = await supabase
        .from('candidate_voting_record')
        .insert(voteRows);
      if (error) console.warn(`  votes insert: ${error.message}`);
    }

    // 5. Replace statements
    await supabase
      .from('candidate_statements')
      .delete()
      .eq('candidate_id', candId);
    if (Array.isArray(c.statements) && c.statements.length > 0) {
      const stmtRows = (c.statements as Array<Record<string, unknown>>).map(
        (s) => ({
          candidate_id: candId,
          statement_text: s.statement_text,
          statement_date: s.statement_date ?? null,
          context: s.context ?? null,
          issue_slugs: s.issue_slugs ?? [],
          source_url: s.source_url ?? null,
          source_quality: s.source_quality ?? 70,
        })
      );
      const { error } = await supabase
        .from('candidate_statements')
        .insert(stmtRows);
      if (error) console.warn(`  statements insert: ${error.message}`);
    }
  }

  console.log(
    `\n[seed-candidates] done. ${eligible.length} candidates seeded for ${raceId}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
