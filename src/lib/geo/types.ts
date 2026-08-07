// Shared types for the 2026 FL congressional district lookup (T04/T05,
// SPEC-2026-08-06.md A3). Kept separate from src/lib/geo.ts, which handles
// unrelated coarse geo (country/region from Vercel headers) and IP/UA
// hashing — this module is about congressional district routing.

/** One entry in the ZIP -> district crosswalk (supabase/seed/zip-districts-2026.json).
 * Built by scripts/ingest/build_zip_crosswalk.ts from 2020-Census-block
 * population, joined against the official EOGPCRP2026 block-equivalency
 * file and the Census ZCTA-to-block relationship file. `pop` and
 * `share_basis` were added in the population-weighted rework
 * (DATA-AUDIT-2026-08-06.md); existing consumers that only read
 * `district`/`share` are unaffected. */
export interface DistrictCrosswalkEntry {
  /** Congressional district number, 1-28 on the 2026 EOGPCRP2026 map. */
  district: number;
  /** Fraction (0-1) of the ZIP's matched population (or, on the area
   * fallback, land area) that falls inside this district. */
  share: number;
  /** 2020 Census population of this ZIP within this district. 0 on the
   * area-share fallback (see `share_basis`), where no population data was
   * available (the ZIP has no residents in the 2020 Census). */
  pop: number;
  /** How `share` was computed. `'population'` (2020 Census block
   * population, the normal case) or `'area'` (land-area intersection,
   * used only for the handful of ZCTAs with zero matched population —
   * e.g. an airport or a state-government complex). */
  share_basis: 'population' | 'area';
}

/** Build provenance for the crosswalk, written by
 * scripts/ingest/build_zip_crosswalk.ts to the sidecar file
 * supabase/seed/zip-districts-2026.meta.json (kept OUT of
 * zip-districts-2026.json itself — that file's top level is a pure
 * `{ "<zip>": DistrictCrosswalkEntry[] }` map on purpose, so every
 * consumer that indexes it by zip code, including ones outside this
 * module, keeps working without a `_meta` key to special-case). */
export interface CrosswalkMeta {
  sources: string[];
  build_date: string;
  share_basis: string;
  min_share_threshold: number;
  min_pop_threshold: number;
  zip_count: number;
  split_zip_count: number;
  area_fallback_zip_count: number;
}
