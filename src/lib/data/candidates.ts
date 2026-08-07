// Server-side candidate query helpers. Pairs with src/lib/data/races.ts.
//
// Two access patterns:
//   1. By race — scorecard carousel, match flow, share OG. Returns the
//      base Candidate + JSONB top_stances. Child relations (donors,
//      voting record, etc.) are lazy and not pulled here.
//   2. By slug — candidate detail page. Pulls all 5 child relations in
//      ONE PostgREST round-trip (atomic, faster than 5× Promise.all
//      from Vercel to Supabase). voting_record is capped at 50 most-
//      recent rows since senate incumbents have 1000+ historical votes
//      and we only render the recent ones.
//
// Active filter (active = true) is applied on both paths. Races whose
// candidates are all unsynthesized show up in race-picker as "Curating
// — check back soon" via the existing empty-state UI.
//
// T16 (Spec C3): every export returns a DataResult<T> instead of
// swallowing a Supabase error into `null` / `[]` / `{}`. `ok: true`
// with an empty result is a legitimate empty state; `ok: false` is a
// DB outage or config problem the caller must show as an honest error
// state.

import { getAnonClient } from './adapter-anon';
import {
  toCandidate,
  toCandidatePosition,
  toCandidateDonor,
  toCandidateTopIndustry,
  toCandidateVote,
  toCandidateStatement,
  dataOk,
  dataErr,
  type DataResult,
  type DataError,
} from './boundary';
import type { CandidateWithFullData } from '@/types/database';

function checkConfigured(): DataError | null {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  return {
    kind: 'config_error',
    message: 'NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local (see .env.example).',
  };
}

/** Columns shared by every candidate query. Keeps the SELECT list DRY. */
const CANDIDATE_BASE_COLUMNS =
  // NOTE (two-phase apply order): fec_coverage_end_date exists in
  // migration 014 but is NOT selected here yet. main auto-deploys, and
  // selecting a column production does not have yet would fail every
  // candidate query site-wide. Add it to this list only in a follow-up
  // AFTER migration 014 is confirmed applied in production. Until then
  // boundary.ts's defensive read returns null and the UI hides the date.
  'id, name, slug, party, state, district, race_id, office, photo_url, bio, website, active, primary_party, incumbent, total_raised, top_stances';

/**
 * Active candidates for one race, ordered by total_raised desc then name.
 * Carousel display only — child relations stay undefined. Use
 * getCandidateBySlug when you need donors/votes/statements/positions.
 * `ok: true, data: []` means zero active candidates (render "Curating").
 */
export async function getCandidatesForRace(
  raceId: string
): Promise<DataResult<CandidateWithFullData[]>> {
  const cfgErr = checkConfigured();
  if (cfgErr) return dataErr(cfgErr);

  const { data, error } = await getAnonClient()
    .from('candidates')
    .select(CANDIDATE_BASE_COLUMNS)
    .eq('race_id', raceId)
    .eq('active', true)
    .order('total_raised', { ascending: false, nullsFirst: false })
    .order('name', { ascending: true });
  if (error) {
    console.error('[data/candidates.getCandidatesForRace] error:', error.message);
    return dataErr({ kind: 'db_error', message: 'Could not load candidates for this race.' });
  }
  return dataOk((data ?? []).map((row) => ({ ...toCandidate(row) })));
}

/**
 * Full candidate detail by slug. ONE PostgREST round-trip with all 5
 * child relations embedded. voting_record capped at 50 most-recent rows.
 * `data: null` means no active candidate matches the slug (404 pattern).
 */
export async function getCandidateBySlug(
  slug: string
): Promise<DataResult<CandidateWithFullData | null>> {
  const cfgErr = checkConfigured();
  if (cfgErr) return dataErr(cfgErr);

  const { data, error } = await getAnonClient()
    .from('candidates')
    .select(
      `${CANDIDATE_BASE_COLUMNS},
       candidate_positions(*),
       candidate_donors(*),
       candidate_top_industries(*),
       candidate_voting_record(*),
       candidate_statements(*)`
    )
    .eq('slug', slug)
    .eq('active', true)
    .order('vote_date', {
      foreignTable: 'candidate_voting_record',
      ascending: false,
    })
    .limit(50, { foreignTable: 'candidate_voting_record' })
    .order('rank', { foreignTable: 'candidate_top_industries', ascending: true })
    .order('amount_total', {
      foreignTable: 'candidate_donors',
      ascending: false,
      nullsFirst: false,
    })
    .order('statement_date', {
      foreignTable: 'candidate_statements',
      ascending: false,
      nullsFirst: false,
    })
    .maybeSingle();

  if (error) {
    console.error('[data/candidates.getCandidateBySlug] error:', error.message);
    return dataErr({ kind: 'db_error', message: 'Could not load this candidate.' });
  }
  if (!data) return dataOk(null);

  const row = data as Record<string, unknown>;
  const base = toCandidate(row);
  const positions = (row.candidate_positions as Record<string, unknown>[] | null) ?? [];
  const donors = (row.candidate_donors as Record<string, unknown>[] | null) ?? [];
  const topIndustries =
    (row.candidate_top_industries as Record<string, unknown>[] | null) ?? [];
  const votingRecord =
    (row.candidate_voting_record as Record<string, unknown>[] | null) ?? [];
  const statements = (row.candidate_statements as Record<string, unknown>[] | null) ?? [];

  return dataOk({
    ...base,
    positions: positions.map(toCandidatePosition),
    donors: donors.map(toCandidateDonor),
    top_industries: topIndustries.map(toCandidateTopIndustry),
    voting_record: votingRecord.map(toCandidateVote),
    statements: statements.map(toCandidateStatement),
  });
}

/**
 * Lightweight candidate samples per race id — minimal columns for
 * race-picker's "N candidates" copy + 4-avatar initials row. One query
 * for the whole race list (no N+1). Filters active=true. Each race's
 * sample is capped at 4 entries (the count of avatars rendered).
 *
 * Returns `{ [raceId]: { count, sample } }`. count is the active
 * candidate total; sample is up to 4 `{ id, name }` rows. If a race
 * has zero active candidates it gets `{ count: 0, sample: [] }`.
 */
export async function getCandidateSamplesForRaces(raceIds: string[]): Promise<
  DataResult<Record<string, { count: number; sample: Array<{ id: string; name: string }> }>>
> {
  if (raceIds.length === 0) return dataOk({});

  const cfgErr = checkConfigured();
  if (cfgErr) return dataErr(cfgErr);

  const { data, error } = await getAnonClient()
    .from('candidates')
    .select('id, name, race_id')
    .in('race_id', raceIds)
    .eq('active', true)
    .order('total_raised', { ascending: false, nullsFirst: false })
    .order('name', { ascending: true });
  if (error) {
    console.error(
      '[data/candidates.getCandidateSamplesForRaces] error:',
      error.message
    );
    return dataErr({ kind: 'db_error', message: 'Could not load candidate counts.' });
  }
  const out: Record<string, { count: number; sample: Array<{ id: string; name: string }> }> = {};
  for (const id of raceIds) out[id] = { count: 0, sample: [] };
  for (const row of (data ?? []) as Array<{
    id: string;
    name: string;
    race_id: string;
  }>) {
    const slot = out[row.race_id];
    if (!slot) continue;
    slot.count += 1;
    if (slot.sample.length < 4) slot.sample.push({ id: row.id, name: row.name });
  }
  return dataOk(out);
}
