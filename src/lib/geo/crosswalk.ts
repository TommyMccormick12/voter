// ZIP -> 2026 congressional district crosswalk reader.
//
// Backs /api/district (T05, SPEC-2026-08-06.md A3). Data file is built by
// scripts/ingest/build_zip_crosswalk.ts from the official EOGPCRP2026
// shapefile + Census ZCTA boundaries (see that script's header comment for
// method). Replaces the old, hand-mapped, pre-2026-map
// supabase/seed/zip-districts.json (DATA-AUDIT-2026-08-06.md root cause 4).
//
// Loaded once at module scope and cached in memory — a Lambda instance
// re-parses this only on cold start, matching the "module scope" load
// instruction in T05.

// Not marked `server-only`: this repo's vitest config runs in jsdom
// without the `react-server` resolve condition, so that guard throws
// under test. The node:fs import below already makes this module
// unusable in a browser bundle.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DistrictCrosswalkEntry } from './types';

const CROSSWALK_PATH = join(
  process.cwd(),
  'supabase',
  'seed',
  'zip-districts-2026.json',
);

let cache: Record<string, DistrictCrosswalkEntry[]> | null = null;

function load(): Record<string, DistrictCrosswalkEntry[]> {
  if (!cache) {
    const raw = readFileSync(CROSSWALK_PATH, 'utf8');
    cache = JSON.parse(raw) as Record<string, DistrictCrosswalkEntry[]>;
  }
  return cache;
}

/**
 * Look up the district(s) a ZIP code overlaps, sorted by descending
 * population share (area share on the fallback — see
 * `DistrictCrosswalkEntry.share_basis`). Returns null when the ZIP is not
 * in the crosswalk — either it is outside Florida, or (on the area
 * fallback) it has no meaningful land-area overlap with any district.
 * Callers should treat null as the honest "not Florida" empty state, not
 * an error.
 */
export function lookupZipDistricts(
  zip: string,
): DistrictCrosswalkEntry[] | null {
  const table = load();
  return table[zip] ?? null;
}
