// Server-side race query helpers. All pages and API routes that need
// race data go through here — never raw Supabase, never mock-data.
//
// Reads only. Service-role writes live in scripts/seed/*. Anon-key
// SELECT is gated by migration 008 (races) + migration 001 (candidates,
// candidate_positions) + migration 005 (donors, industries, votes,
// statements) RLS policies.
//
// Hard-errors when NEXT_PUBLIC_SUPABASE_URL is unset. Silent mock
// substitution was the bug class that hid the empty-DB state for weeks
// during the FL ingest; we don't want that recurring.

import { getAnonClient } from './adapter-anon';
import { toRace } from './boundary';
import type { Race } from '@/types/database';
import zipDistricts from '../../../supabase/seed/zip-districts-2026.json';

// zip-districts-2026.json (T04, spec A3) maps each FL ZCTA to every
// congressional district it overlaps, with `share` = the fraction of
// the ZCTA's area/population in that district. Split ZIPs carry more
// than one entry. Full split-ZIP resolution (prompt for street
// address -> /api/district -> point-in-polygon) is T05/T06 — this
// module stays on the majority-share district as a same-behavior
// stopgap so getRacesForZip keeps returning a single district today.
interface ZipDistrictShare {
  district: number;
  share: number;
}

const ZIP_LOOKUP = zipDistricts as Record<string, ZipDistrictShare[] | undefined>;

function lookupZip(zip: string): string | null {
  const entries = ZIP_LOOKUP[zip];
  if (!entries || entries.length === 0) return null;
  const majority = entries.reduce((best, e) => (e.share > best.share ? e : best));
  return String(majority.district).padStart(2, '0');
}

function assertConfigured(): void {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local (see .env.example).'
    );
  }
}

/**
 * Fetch a single race by id. Returns null when no row matches (404
 * pattern — pages render `notFound()` on null).
 */
export async function getRace(raceId: string): Promise<Race | null> {
  assertConfigured();
  const { data, error } = await getAnonClient()
    .from('races')
    .select(
      'id, state, district, office, election_date, cycle, election_type, primary_party'
    )
    .eq('id', raceId)
    .maybeSingle();
  if (error) {
    console.error('[data/races.getRace] error:', error.message);
    return null;
  }
  return data ? toRace(data) : null;
}

/**
 * Fetch races by id list. Used by `getRacesForZip` and any other path
 * that already knows the race-id set. Preserves the input order so
 * callers can rely on it for "Senate / Governor / your House district"
 * sort.
 */
export async function getRacesByIds(ids: string[]): Promise<Race[]> {
  if (ids.length === 0) return [];
  assertConfigured();
  const { data, error } = await getAnonClient()
    .from('races')
    .select(
      'id, state, district, office, election_date, cycle, election_type, primary_party'
    )
    .in('id', ids);
  if (error) {
    console.error('[data/races.getRacesByIds] error:', error.message);
    return [];
  }
  const byId = new Map<string, Race>();
  for (const row of data ?? []) byId.set(row.id, toRace(row));
  return ids.map((id) => byId.get(id)).filter((r): r is Race => r !== undefined);
}

/**
 * Resolve a ZIP to the set of primary races on its ballot.
 *
 * Currently FL-only — see plan §15. Non-FL ZIPs return [] and the
 * race-picker page renders the "Florida only for now" empty state.
 *
 * Returns 6 race ids in this order: District R, District D, Senate R,
 * Senate D, Governor R, Governor D. Missing races (uncontested or
 * not-yet-seeded) drop out of the result quietly via getRacesByIds.
 */
export async function getRacesForZip(zip: string): Promise<Race[]> {
  const districtId = lookupZip(zip);
  if (!districtId) return [];

  const candidateRaceIds = [
    `race-fl-${districtId}-r-2026`,
    `race-fl-${districtId}-d-2026`,
    'race-fl-sen-r-2026',
    'race-fl-sen-d-2026',
    'race-fl-gov-r-2026',
    'race-fl-gov-d-2026',
  ];

  return getRacesByIds(candidateRaceIds);
}
