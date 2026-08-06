// 2026 FL congressional district geometry — point-in-polygon lookup.
//
// Backs /api/district's address-based flow (T05, SPEC-2026-08-06.md A3).
// Reads the committed GeoJSON built from the official EOGPCRP2026
// shapefile (flsenate.gov Redistricting > Congressional; see
// supabase/seed/geo/fl-congress-2026.geojson and the conversion note in
// supabase/seed/README.md). 28 districts, each carrying its district
// number as a `district` property.
//
// Loaded once at module scope per the T05 instruction — a Lambda instance
// pays the JSON.parse cost once on cold start, not per request.

// Not marked `server-only` -- see the comment in ./crosswalk.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { booleanPointInPolygon, point } from '@turf/turf';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';

const DISTRICTS_PATH = join(
  process.cwd(),
  'supabase',
  'seed',
  'geo',
  'fl-congress-2026.geojson',
);

type DistrictProperties = { district: number; name?: string };
type DistrictFeatureCollection = FeatureCollection<
  Polygon | MultiPolygon,
  DistrictProperties
>;

let cache: DistrictFeatureCollection | null = null;

function load(): DistrictFeatureCollection {
  if (!cache) {
    const raw = readFileSync(DISTRICTS_PATH, 'utf8');
    cache = JSON.parse(raw) as DistrictFeatureCollection;
  }
  return cache;
}

/**
 * Resolve the congressional district that contains a lat/lon point.
 * Returns null when the point falls outside all 28 FL districts (address
 * outside Florida, or just off the coastline past the simplified
 * boundary).
 *
 * Callers must supply coordinates from their OWN geocoding step. This
 * function never receives or reasons about the source address — only
 * numeric coordinates, so it carries no address-privacy risk itself.
 */
export function districtForPoint(lon: number, lat: number): number | null {
  const fc = load();
  const pt = point([lon, lat]);
  for (const feature of fc.features) {
    if (booleanPointInPolygon(pt, feature)) {
      return feature.properties.district;
    }
  }
  return null;
}
