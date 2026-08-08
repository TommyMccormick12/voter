// Insert candidate rows + their stances/donors/industries/votes/statements
// from a race fixture into Supabase. Idempotent via upserts on stable IDs.
//
// Only inserts candidates marked active=true (gated by activate_candidate.ts).
//
// T12 (2026-08-06, SPEC-2026-08-06.md §B4): loud-failure + freshness gate.
//
// MECHANISM — child-insert failure abort (replaces the old
// delete-then-warn-and-continue flow, DATA-AUDIT-2026-08-06 root cause 3
// #6, which could leave a live candidate with emptied child records):
//
//   True atomicity is not available here — PostgREST/Supabase-js gives us
//   no multi-table transaction, and re-inserting deleted rows after a
//   failure is not reliably atomic either (the re-insert call can itself
//   fail). So the fix is two layers instead of a rollback:
//
//   Layer 1 (proactive, before any DB write for this candidate):
//     validateAllChildRows() from ./seed-validation checks every child row
//     against the NOT NULL / CHECK constraints actually declared on
//     candidate_donors / candidate_top_industries / candidate_voting_record
//     / candidate_statements (supabase/migrations/004_primary_pivot.sql).
//     If any row would fail those constraints, we skip this candidate
//     ENTIRELY — no candidate upsert, no delete, no insert. Whatever was
//     already live for this candidate (if anything) is untouched.
//
//   Layer 2 (safety net, after delete has already run): a structurally
//     valid row can still be rejected by Postgres for a reason we can't
//     check client-side (FK violation, transient error, etc.). If any
//     insert() call fails at that point, the candidate's children are
//     already gone (delete succeeded) — we cannot silently continue. We
//     immediately UPDATE candidates.active = false for that candidate id,
//     so the emptied-children candidate is taken off the live site instead
//     of rendering with holes, log a loud error, and record the failure.
//
//   Either layer causes this candidate's seed to be skipped/reverted; it
//   does NOT abort the whole race — other candidates in the same fixture
//   still get seeded. The script exits non-zero at the end if ANY
//   candidate failed either layer, so CI/operators can't miss it in
//   scrollback.
//
// MECHANISM — freshness gate (T12 item 4): before doing anything else for
// an active candidate, we require candidates_fixture.verified_at to be
// present and within VERIFICATION_FRESHNESS_DAYS (imported from
// scripts/review/activation-gate.ts via ./seed-validation — same named
// constant as activate_candidate.ts, not a duplicated magic number). A
// candidate can be reviewed-and-activated but then sit unseeded for weeks;
// this is the gate that actually keeps that stale review out of
// production, per DATA-AUDIT-2026-08-06's freshness-contract
// recommendation.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed/seed_candidates.ts \
//     --race-id race-nj-07-r-2026

import '../_env';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';
import { stripTitles } from '../../src/lib/api-clients/names';
import { getAdminClient } from './supabase-admin';
import { candidateWebsite } from './candidate-website';
import {
  validateAllChildRows,
  isVerifiedFresh,
  VERIFICATION_FRESHNESS_DAYS,
} from './seed-validation';

type AdminClient = ReturnType<typeof getAdminClient>;

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

interface ChildRowSets {
  donorRows: Array<Record<string, unknown>>;
  indRows: Array<Record<string, unknown>>;
  voteRows: Array<Record<string, unknown>>;
  stmtRows: Array<Record<string, unknown>>;
}

/** Pure transform from fixture candidate -> the four child row arrays. No DB call. */
function buildChildRows(
  c: Record<string, unknown>,
  fixture: { race: { cycle?: number } }
): ChildRowSets {
  const donorRows = (
    (Array.isArray(c.donors) ? c.donors : []) as Array<Record<string, unknown>>
  ).map((d) => ({
    donor_name: d.donor_name,
    donor_type: d.donor_type ?? null,
    industry: d.industry ?? null,
    amount_total: d.amount_total,
    cycle: d.cycle ?? fixture.race.cycle,
    fec_committee_id: d.fec_committee_id ?? null,
    data_source: d.data_source ?? 'opensecrets',
    rank_in_candidate: d.rank_in_candidate ?? null,
  }));

  const indRows = (
    (Array.isArray(c.top_industries) ? c.top_industries : []) as Array<
      Record<string, unknown>
    >
  ).map((i) => ({
    industry_name: i.industry_name,
    industry_code: i.industry_code ?? null,
    amount: i.amount,
    rank: i.rank,
    cycle: i.cycle ?? fixture.race.cycle,
    data_source: i.data_source ?? 'opensecrets',
  }));

  const voteRows = (
    (Array.isArray(c.voting_record) ? c.voting_record : []) as Array<
      Record<string, unknown>
    >
  ).map((v) => ({
    bill_id: v.bill_id,
    bill_title: v.bill_title,
    // Legacy fixtures stored the question in bill_title. Keep that value
    // when vote_question is absent so migration 016 never receives a blank.
    vote_question: v.vote_question ?? v.bill_title,
    bill_summary: v.bill_summary ?? null,
    vote: v.vote,
    issue_slugs: v.issue_slugs ?? [],
    vote_date: v.vote_date,
    source: v.source ?? 'govtrack',
    source_url: v.source_url ?? null,
    significance: v.significance ?? 'major',
    roll_call_id: v.roll_call_id,
  }));

  const stmtRows = (
    (Array.isArray(c.statements) ? c.statements : []) as Array<
      Record<string, unknown>
    >
  ).map((s) => ({
    statement_text: s.statement_text,
    statement_date: s.statement_date ?? null,
    context: s.context ?? null,
    issue_slugs: s.issue_slugs ?? [],
    source_url: s.source_url ?? null,
    source_quality: s.source_quality ?? 70,
  }));

  return { donorRows, indRows, voteRows, stmtRows };
}

async function replaceChildRows(
  supabase: AdminClient,
  table: string,
  candId: string,
  rows: Array<Record<string, unknown>>
): Promise<{ error?: string }> {
  const del = await supabase.from(table).delete().eq('candidate_id', candId);
  if (del.error) return { error: `${table} delete: ${del.error.message}` };
  if (rows.length === 0) return {};
  const withCandId = rows.map((r) => ({ ...r, candidate_id: candId }));
  const ins = await supabase.from(table).insert(withCandId);
  if (ins.error) return { error: `${table} insert: ${ins.error.message}` };
  return {};
}

/**
 * Delete-then-insert each child table for one candidate, stopping at the
 * first failure. This is layer 2 of the abort mechanism (see file header):
 * by the time an error surfaces here, that table's old rows are already
 * gone, so the caller must mark the candidate inactive rather than
 * continue to the next table.
 */
async function seedChildTables(
  supabase: AdminClient,
  candId: string,
  { donorRows, indRows, voteRows, stmtRows }: ChildRowSets
): Promise<{ ok: true } | { ok: false; error: string }> {
  const steps: Array<[string, Array<Record<string, unknown>>]> = [
    ['candidate_donors', donorRows],
    ['candidate_top_industries', indRows],
    ['candidate_voting_record', voteRows],
    ['candidate_statements', stmtRows],
  ];
  for (const [table, rows] of steps) {
    const { error } = await replaceChildRows(supabase, table, candId, rows);
    if (error) return { ok: false, error };
  }
  return { ok: true };
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

  const now = new Date();
  const failures: string[] = [];
  let seededCount = 0;

  for (const c of eligible) {
    const slug = c.slug as string;
    if (!slug) {
      console.warn(`[seed-candidates] skipping candidate without slug:`, c.name);
      continue;
    }

    // --- Freshness gate (T12 item 4): only applies to active candidates. ---
    if (c.active === true) {
      const verifiedAt = c.verified_at as string | undefined;
      if (!isVerifiedFresh(verifiedAt, now, VERIFICATION_FRESHNESS_DAYS)) {
        const msg = verifiedAt
          ? `${slug}: verified_at is stale (${verifiedAt}, freshness window ${VERIFICATION_FRESHNESS_DAYS}d)`
          : `${slug}: verified_at is missing`;
        console.error(
          `[seed-candidates] REFUSING to seed ${msg}. Re-run activate_candidate.ts to re-verify before seeding.`
        );
        failures.push(msg);
        continue;
      }
    }

    // --- Layer 1: validate every child row BEFORE any DB write. ---
    const childRows = buildChildRows(c, fixture);
    const validation = validateAllChildRows({
      donors: childRows.donorRows,
      industries: childRows.indRows,
      votes: childRows.voteRows,
      statements: childRows.stmtRows,
    });
    if (!validation.ok) {
      console.error(
        `[seed-candidates] REFUSING to seed ${slug}: child rows would fail DB constraints:\n  ${validation.errors.join('\n  ')}`
      );
      failures.push(`${slug}: invalid child rows (${validation.errors.length} error(s))`);
      continue; // no DB writes at all for this candidate
    }

    // 1. Upsert candidate.
    //
    // stripTitles on `name` cleans FEC-embedded courtesy tokens
    // ("Scott Mr. Franklin" → "Scott Franklin") for display-side use.
    // Slug is preserved as-is — it's already in Supabase as the stable
    // identifier and is used in /candidate/[slug] URLs; renaming it would
    // break any saved links / shares.
    // Pre-flight the coverage date the same way seed-validation shape-checks
    // vote_date: a malformed value must fail here, loudly, not as a Postgres
    // date-cast error mid-upsert. NULL is the honest "unknown" the UI hides.
    const rawCoverage = c.fec_coverage_end_date;
    let fecCoverageEndDate: string | null = null;
    if (
      typeof rawCoverage === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(rawCoverage) &&
      !Number.isNaN(Date.parse(rawCoverage))
    ) {
      fecCoverageEndDate = rawCoverage;
    } else if (rawCoverage != null) {
      console.warn(
        `[seed-candidates] ${slug}: invalid fec_coverage_end_date ${JSON.stringify(rawCoverage)} — seeding NULL (UI will show no coverage date)`
      );
    }

    const candidateRow = {
      id: (c.id as string | undefined) ?? `cand-${slug}`,
      slug,
      name: stripTitles(c.name as string),
      party: (c.party as string) ?? null,
      primary_party: (c.party as string)?.charAt(0).toUpperCase() ?? null,
      state: fixture.race.state,
      district: fixture.race.district ?? null,
      race_id: fixture.race.id,
      office: fixture.race.office,
      photo_url: (c.photo_url as string) ?? null,
      bio: (c.bio as string) ?? null,
      website: candidateWebsite(c),
      active: true,
      incumbent: (c.incumbent as boolean) ?? false,
      total_raised: (c.total_raised as number) ?? null,
      // Stamped by fetch_fec.ts from FEC totals coverage_end_date; NULL
      // means unknown and the UI renders no coverage date (migration 014).
      // REQUIRES migration 014 applied — an upsert against a DB without
      // the column fails loudly with PGRST204 for every candidate.
      fec_coverage_end_date: fecCoverageEndDate,
      top_stances: c.top_stances ?? [],
      verified_at: (c.verified_at as string) ?? null,
    };

    const { error: candErr } = await supabase
      .from('candidates')
      .upsert(candidateRow, { onConflict: 'slug' });
    if (candErr) {
      console.error(`[seed-candidates] ${slug} upsert failed:`, candErr.message);
      failures.push(`${slug}: candidate upsert failed (${candErr.message})`);
      continue;
    }

    const candId = candidateRow.id;

    // 2-5. Replace donors/industries/votes/statements (layer 2: abort +
    // deactivate on first failure — see file header mechanism note).
    const childResult = await seedChildTables(supabase, candId, childRows);
    if (!childResult.ok) {
      console.error(
        `[seed-candidates] ${slug}: child insert failed after delete (${childResult.error}). Marking candidate INACTIVE so it does not render with emptied records.`
      );
      const { error: deactErr } = await supabase
        .from('candidates')
        .update({ active: false })
        .eq('id', candId);
      if (deactErr) {
        console.error(
          `[seed-candidates] ${slug}: ALSO failed to mark inactive (${deactErr.message}). MANUAL INTERVENTION REQUIRED — this candidate may be live with emptied child records.`
        );
      }
      failures.push(`${slug}: child insert failed (${childResult.error})`);
      continue;
    }

    seededCount++;
    console.log(`[seed-candidates] upserted ${slug}`);
  }

  if (failures.length > 0) {
    console.error(
      `\n[seed-candidates] ${failures.length} candidate(s) FAILED and were not fully seeded:\n${failures.map((f) => ` - ${f}`).join('\n')}`
    );
  }
  console.log(
    `\n[seed-candidates] done. ${seededCount}/${eligible.length} candidates seeded for ${raceId}`
  );
  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
