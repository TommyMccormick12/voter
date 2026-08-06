// Server-side race query helpers. All pages and API routes that need
// race data go through here — never raw Supabase, never mock-data.
//
// Reads only. Service-role writes live in scripts/seed/*. Anon-key
// SELECT is gated by migration 008 (races) + migration 001 (candidates,
// candidate_positions) + migration 005 (donors, industries, votes,
// statements) RLS policies.
//
// T16 (Spec C3): every export returns a DataResult<T> instead of
// swallowing a Supabase error into `null` / `[]`. `ok: true` with an
// empty array is a legitimate empty result; `ok: false` is a DB outage
// or config problem the caller must show as an honest error state, not
// an empty one. Silent mock substitution / swallowed errors was the
// bug class that hid the empty-DB state for weeks during the FL
// ingest; we don't want that recurring.

import { getAnonClient } from './adapter-anon';
import { toRace, dataOk, dataErr, type DataResult, type DataError } from './boundary';
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

/**
 * True when the zip falls inside FL district coverage. Callers use this
 * to tell "filtered empty" (zip outside coverage — the honest "Florida
 * only for now" state) apart from "empty" (in-coverage district with no
 * races seeded yet — "Curating").
 */
export function isZipCovered(zip: string): boolean {
  return lookupZip(zip) !== null;
}

function configError(): DataError {
  return {
    kind: 'config_error',
    message: 'NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local (see .env.example).',
  };
}

function checkConfigured(): DataError | null {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ? null : configError();
}

/**
 * Fetch a single race by id. `data: null` means no row matches (404
 * pattern — pages render `notFound()` on a null success). `ok: false`
 * means the read itself failed.
 */
export async function getRace(raceId: string): Promise<DataResult<Race | null>> {
  const cfgErr = checkConfigured();
  if (cfgErr) return dataErr(cfgErr);

  const { data, error } = await getAnonClient()
    .from('races')
    .select(
      'id, state, district, office, election_date, cycle, election_type, primary_party'
    )
    .eq('id', raceId)
    .maybeSingle();
  if (error) {
    console.error('[data/races.getRace] error:', error.message);
    return dataErr({ kind: 'db_error', message: 'Could not load this race.' });
  }
  return dataOk(data ? toRace(data) : null);
}

/**
 * Fetch races by id list. Used by `getRacesForZip` and any other path
 * that already knows the race-id set. Preserves the input order so
 * callers can rely on it for "Senate / Governor / your House district"
 * sort.
 */
export async function getRacesByIds(ids: string[]): Promise<DataResult<Race[]>> {
  if (ids.length === 0) return dataOk([]);

  const cfgErr = checkConfigured();
  if (cfgErr) return dataErr(cfgErr);

  const { data, error } = await getAnonClient()
    .from('races')
    .select(
      'id, state, district, office, election_date, cycle, election_type, primary_party'
    )
    .in('id', ids);
  if (error) {
    console.error('[data/races.getRacesByIds] error:', error.message);
    return dataErr({ kind: 'db_error', message: 'Could not load races.' });
  }
  const byId = new Map<string, Race>();
  for (const row of data ?? []) byId.set(row.id, toRace(row));
  return dataOk(ids.map((id) => byId.get(id)).filter((r): r is Race => r !== undefined));
}

/**
 * Resolve a ZIP to the set of primary races on its ballot.
 *
 * Currently FL-only — see plan §15. Zips outside FL district coverage
 * resolve `ok: true, data: []`; callers should check `isZipCovered`
 * first to render the "Florida only for now" filtered-empty state
 * instead of the in-coverage "Curating" empty state.
 *
 * Returns up to 6 race ids in this order: District R, District D,
 * Senate R, Senate D, Governor R, Governor D. Missing races
 * (uncontested or not-yet-seeded) drop out of the result quietly via
 * getRacesByIds.
 */
export async function getRacesForZip(zip: string): Promise<DataResult<Race[]>> {
  const districtId = lookupZip(zip);
  if (!districtId) return dataOk([]);

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
