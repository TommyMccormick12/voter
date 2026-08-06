// Shared types for the 2026 FL congressional district lookup (T04/T05,
// SPEC-2026-08-06.md A3). Kept separate from src/lib/geo.ts, which handles
// unrelated coarse geo (country/region from Vercel headers) and IP/UA
// hashing — this module is about congressional district routing.

/** One entry in the ZIP -> district crosswalk (supabase/seed/zip-districts-2026.json). */
export interface DistrictCrosswalkEntry {
  /** Congressional district number, 1-28 on the 2026 EOGPCRP2026 map. */
  district: number;
  /** Fraction (0-1) of the ZCTA's land area that falls inside this district. */
  share: number;
}
