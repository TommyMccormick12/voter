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

import { supabase } from '@/lib/supabase';
import type { Race } from '@/types/database';
import zipDistricts from '../../../supabase/seed/zip-districts.json';

interface ZipDistrictEntry {
  state: string;
  district: string;
}

const ZIP_LOOKUP = zipDistricts as Record<
  string,
  ZipDistrictEntry | null | { _note?: string }
>;

function lookupZip(zip: string): ZipDistrictEntry | null {
  const raw = ZIP_LOOKUP[zip];
  if (!raw || !('state' in raw) || !('district' in raw)) return null;
  return raw as ZipDistrictEntry;
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
  const { data, error } = await supabase
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
  return (data as Race | null) ?? null;
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
  const { data, error } = await supabase
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
  for (const row of (data ?? []) as Race[]) byId.set(row.id, row);
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
  const lookup = lookupZip(zip);
  if (!lookup || lookup.state !== 'FL') return [];

  const districtId = lookup.district.padStart(2, '0');
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
