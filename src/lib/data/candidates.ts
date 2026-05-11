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

import { supabase } from '@/lib/supabase';
import type {
  Candidate,
  CandidateWithFullData,
  CandidatePosition,
  CandidateDonor,
  CandidateTopIndustry,
  CandidateVote,
  CandidateStatement,
  TopStance,
} from '@/types/database';

function assertConfigured(): void {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local (see .env.example).'
    );
  }
}

/** Columns shared by every candidate query. Keeps the SELECT list DRY. */
const CANDIDATE_BASE_COLUMNS =
  'id, name, slug, party, state, district, race_id, office, photo_url, bio, website, active, primary_party, incumbent, total_raised, top_stances';

/**
 * Coerce a raw Supabase candidate row to the app's Candidate shape.
 * Guards against JSONB drift: top_stances must be an array of objects.
 * Returns `top_stances: []` when the column is null / malformed so the
 * UI renders an empty stance list instead of crashing.
 */
function normalizeCandidate(row: Record<string, unknown>): Candidate {
  const rawStances = row.top_stances;
  let top_stances: TopStance[] = [];
  if (Array.isArray(rawStances)) {
    top_stances = rawStances.filter(
      (s): s is TopStance =>
        typeof s === 'object' && s !== null && 'issue_slug' in s && 'stance' in s
    );
  }
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    party: (row.party as string | null) ?? null,
    state: String(row.state),
    district: (row.district as string | null) ?? null,
    race_id: (row.race_id as string | null) ?? null,
    office: String(row.office),
    photo_url: (row.photo_url as string | null) ?? null,
    bio: (row.bio as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    active: Boolean(row.active),
    primary_party: (row.primary_party as string | null) ?? null,
    incumbent: Boolean(row.incumbent),
    total_raised: (row.total_raised as number | null) ?? null,
    top_stances,
  };
}

/**
 * Active candidates for one race, ordered by total_raised desc then name.
 * Carousel display only — child relations stay undefined. Use
 * getCandidateBySlug when you need donors/votes/statements/positions.
 */
export async function getCandidatesForRace(
  raceId: string
): Promise<CandidateWithFullData[]> {
  assertConfigured();
  const { data, error } = await supabase
    .from('candidates')
    .select(CANDIDATE_BASE_COLUMNS)
    .eq('race_id', raceId)
    .eq('active', true)
    .order('total_raised', { ascending: false, nullsFirst: false })
    .order('name', { ascending: true });
  if (error) {
    console.error('[data/candidates.getCandidatesForRace] error:', error.message);
    return [];
  }
  return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    ...normalizeCandidate(row),
  }));
}

/**
 * Full candidate detail by slug. ONE PostgREST round-trip with all 5
 * child relations embedded. voting_record capped at 50 most-recent rows.
 */
export async function getCandidateBySlug(
  slug: string
): Promise<CandidateWithFullData | null> {
  assertConfigured();
  const { data, error } = await supabase
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
    return null;
  }
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const base = normalizeCandidate(row);
  return {
    ...base,
    positions: (row.candidate_positions as CandidatePosition[] | null) ?? [],
    donors: (row.candidate_donors as CandidateDonor[] | null) ?? [],
    top_industries:
      (row.candidate_top_industries as CandidateTopIndustry[] | null) ?? [],
    voting_record: (row.candidate_voting_record as CandidateVote[] | null) ?? [],
    statements: (row.candidate_statements as CandidateStatement[] | null) ?? [],
  };
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
  Record<string, { count: number; sample: Array<{ id: string; name: string }> }>
> {
  if (raceIds.length === 0) return {};
  assertConfigured();
  const { data, error } = await supabase
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
    return {};
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
  return out;
}
