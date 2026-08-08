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
//
// T06 (Spec A3/A5) — ZIP -> district contract.
//
// The old `getRacesForZip` took the crosswalk's majority-share entry
// (`entries[0]`) as THE district for every zip, including genuinely
// split zips. That was a same-behavior stopgap explicitly called out as
// wrong in this file's previous header comment, and it silently
// misrouted every split zip to whichever district holds the population
// plurality. `zip-districts-2026.json` (built by
// scripts/ingest/build_zip_crosswalk.ts, read via `src/lib/geo/
// crosswalk.ts`) orders each zip's districts by descending population
// share; `entries[0]` is a fine DISPLAY default but must never be
// silently presented as *the* resolved district for a split zip — the
// real answer for a split zip only exists after a street address is
// geocoded and resolved via POST /api/district (see
// src/app/api/district/route.ts and src/app/race-picker/page.tsx).
//
// New contract:
//   - `getDistrictsForZip` classifies a zip as single / split /
//     out_of_coverage, with no DB read (crosswalk is a committed JSON
//     file, loaded once at module scope by src/lib/geo/crosswalk.ts).
//   - `getRacesForDistrict` / `getRacesForDistricts` fetch races once
//     the caller KNOWS the resolved district(s) — single-zip case
//     directly, split-zip case only after /api/district resolves one
//     (or the user picks the explicit "show all N districts" fallback).
//   - `getRacesForZip` is kept only for single-district zips (or a
//     caller that has already resolved to one district elsewhere); it
//     returns `ok: true, data: []` for a split zip rather than ever
//     guessing — callers that need split-zip handling must call
//     `getDistrictsForZip` first and branch on `kind`.
//
// Governor is intentionally absent from every race-id list this module
// builds (Spec A4 / Decision 8 — no Governor surface this run). Senate
// is statewide: the same two race ids (`race-fl-sen-{r,d}-2026`) are
// included for every FL district, never varied by district.

import { getAnonClient } from './adapter-anon';
import { toRace, dataOk, dataErr, type DataResult, type DataError } from './boundary';
import type { Race } from '@/types/database';
import { lookupZipDistricts } from '@/lib/geo/crosswalk';

/**
 * Result of classifying a zip against the ZIP -> district crosswalk.
 * `district` / `districts` are 2-digit zero-padded strings matching the
 * `district` field already used on Race/Candidate (e.g. "01", "10") and
 * the `race-fl-<district>-{r,d}-2026` id convention.
 */
export type DistrictResolution =
  | { kind: 'single'; district: string }
  | { kind: 'split'; districts: string[] }
  | { kind: 'out_of_coverage' };

function padDistrict(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Classify a zip: single-district (answer directly), split (genuinely
 * straddles district lines — caller must resolve via /api/district or
 * an explicit "show all" fallback, never assume `districts[0]`), or
 * out_of_coverage (outside FL, or no district clears the crosswalk's
 * noise floor — the honest "Florida only for now" case, not an error).
 * Pure and synchronous: the crosswalk is a committed JSON file read
 * once at module scope by src/lib/geo/crosswalk.ts, no DB round-trip.
 */
export function getDistrictsForZip(zip: string): DistrictResolution {
  const entries = lookupZipDistricts(zip);
  if (!entries || entries.length === 0) return { kind: 'out_of_coverage' };
  if (entries.length === 1) {
    return { kind: 'single', district: padDistrict(entries[0].district) };
  }
  return { kind: 'split', districts: entries.map((e) => padDistrict(e.district)) };
}

/**
 * True when the zip falls inside FL district coverage (single or
 * split — both count as "covered"). Callers use this to tell "filtered
 * empty" (zip outside coverage — the honest "Florida only for now"
 * state) apart from "empty" (in-coverage district with no races seeded
 * yet — "Curating").
 */
export function isZipCovered(zip: string): boolean {
  return getDistrictsForZip(zip).kind !== 'out_of_coverage';
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
    // '*' includes the no-primary fields from migration 013. boundary.ts
    // extracts each application field defensively.
    .select('*')
    .eq('id', raceId)
    .maybeSingle();
  if (error) {
    console.error('[data/races.getRace] error:', error.message);
    return dataErr({ kind: 'db_error', message: 'Could not load this race.' });
  }
  return dataOk(data ? toRace(data) : null);
}

/**
 * Fetch races by id list. Used by every district-scoped helper below.
 * Preserves the input order so callers can rely on it for "Senate /
 * your House district" sort. Ids with no matching row (uncontested,
 * not-yet-seeded, or a district with no active races) drop out
 * quietly — a legitimate empty result, not an error.
 */
export async function getRacesByIds(ids: string[]): Promise<DataResult<Race[]>> {
  if (ids.length === 0) return dataOk([]);

  const cfgErr = checkConfigured();
  if (cfgErr) return dataErr(cfgErr);

  const { data, error } = await getAnonClient()
    .from('races')
    // '*' includes the no-primary fields from migration 013. boundary.ts
    // extracts each application field defensively.
    .select('*')
    .in('id', ids);
  if (error) {
    console.error('[data/races.getRacesByIds] error:', error.message);
    return dataErr({ kind: 'db_error', message: 'Could not load races.' });
  }
  const byId = new Map<string, Race>();
  for (const row of data ?? []) byId.set(row.id, toRace(row));
  return dataOk(ids.map((id) => byId.get(id)).filter((r): r is Race => r !== undefined));
}

/** The two statewide Senate primary race ids — same for every FL district. */
const STATEWIDE_SENATE_RACE_IDS = ['race-fl-sen-r-2026', 'race-fl-sen-d-2026'];

function houseRaceIdsForDistrict(district: string): string[] {
  return [`race-fl-${district}-r-2026`, `race-fl-${district}-d-2026`];
}

/**
 * Races on the ballot for ONE resolved district: that district's House
 * R/D primaries plus the statewide Senate R/D primaries. Use this once
 * a district is known — directly for a single-district zip, or after
 * /api/district resolves a split zip to one district via street
 * address.
 */
export async function getRacesForDistrict(district: string): Promise<DataResult<Race[]>> {
  return getRacesByIds([...houseRaceIdsForDistrict(district), ...STATEWIDE_SENATE_RACE_IDS]);
}

/**
 * Races across MULTIPLE districts — backs the split-zip "show races
 * for all N districts in this zip" explicit fallback (never a silent
 * default). Unions each district's House races with the statewide
 * Senate races counted once, not once per district.
 */
export async function getRacesForDistricts(districts: string[]): Promise<DataResult<Race[]>> {
  const houseIds = districts.flatMap(houseRaceIdsForDistrict);
  const ids = [...new Set([...houseIds, ...STATEWIDE_SENATE_RACE_IDS])];
  return getRacesByIds(ids);
}

/**
 * Resolve a zip directly to its races — ONLY valid for a single-
 * district zip. Returns `ok: true, data: []` for a split zip or a
 * zip outside coverage rather than guessing a district; callers that
 * must handle split zips (the race-picker page) call
 * `getDistrictsForZip` first and branch on `kind` instead of relying
 * on this function to do it for them.
 */
export async function getRacesForZip(zip: string): Promise<DataResult<Race[]>> {
  const resolution = getDistrictsForZip(zip);
  if (resolution.kind !== 'single') return dataOk([]);
  return getRacesForDistrict(resolution.district);
}
