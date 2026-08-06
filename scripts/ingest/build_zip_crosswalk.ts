// Build the FL ZIP → congressional-district crosswalk for the 2026 map.
//
// Why this script exists: the old `supabase/seed/zip-districts.json` was a
// hand-made file pinned to the pre-2026 map (Decision list, DATA-AUDIT
// 2026-08-06). This script replaces it with a crosswalk computed from two
// official sources:
//   1. The committed `supabase/seed/geo/fl-congress-2026.geojson`
//      (EOGPCRP2026, 28 districts — see scripts that produced it in
//      supabase/seed/README.md).
//   2. The US Census cartographic-boundary ZCTA5 file (`cb_2020_us_zcta520_500k`,
//      the current vintage — ZCTA boundaries have not been redrawn since 2020;
//      re-download is unnecessary for future runs).
//
// Method: for every ZCTA whose code falls in the FL prefix range (320xx-349xx),
// intersect its polygon against all 28 district polygons (turf). A district
// is kept for a ZIP only when it covers more than 2% of the ZCTA's area (the
// "noise floor" — slivers from boundary-simplification artifacts don't count
// as real coverage). Output: `supabase/seed/zip-districts-2026.json`,
// `{ "<zip>": [{ "district": <n>, "share": <0-1> }, ...] }`, districts sorted
// by descending share.
//
// Usage:
//   npx tsx scripts/ingest/build_zip_crosswalk.ts
//
// Re-run is safe: the large Census ZIP is cached under supabase/seed/raw/
// (gitignored, machine-local) and only re-downloaded if missing or with
// --force.

import '../_env';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as turf from '@turf/turf';
import type {
  BBox,
  Feature,
  FeatureCollection,
  Polygon,
  MultiPolygon,
} from 'geojson';

const REPO_ROOT = process.cwd();
const GEO_DIR = join(REPO_ROOT, 'supabase', 'seed', 'geo');
const RAW_CENSUS_DIR = join(REPO_ROOT, 'supabase', 'seed', 'raw', 'census');
const DISTRICTS_PATH = join(GEO_DIR, 'fl-congress-2026.geojson');
const OUT_PATH = join(REPO_ROOT, 'supabase', 'seed', 'zip-districts-2026.json');

const ZCTA_ZIP_URL =
  'https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip';
const ZCTA_ZIP_PATH = join(RAW_CENSUS_DIR, 'cb_2020_us_zcta520_500k.zip');
const ZCTA_FL_GEOJSON_PATH = join(RAW_CENSUS_DIR, 'zcta-fl-prefix.geojson');

// A district only counts toward a ZIP's crosswalk entry above this area
// share. Below this, the overlap is boundary-simplification noise, not a
// real slice of the ZIP.
const NOISE_FLOOR = 0.02;

// Florida ZCTA5 codes fall in 320xx-349xx. Georgia/Alabama neighbors use
// disjoint prefix ranges, so this is a safe pre-filter — the real
// inclusion test is the geometric intersection against the district
// shapefile below, not this prefix.
const FL_ZIP_PREFIX = /^3[2-4]/;

type Poly = Feature<Polygon | MultiPolygon>;

interface CrosswalkEntry {
  district: number;
  share: number;
}

function log(msg: string): void {
  console.log(`[zip-crosswalk] ${msg}`);
}

async function ensureZctaZip(force: boolean): Promise<void> {
  if (existsSync(ZCTA_ZIP_PATH) && !force) {
    log(`using cached ${ZCTA_ZIP_PATH}`);
    return;
  }
  mkdirSync(dirname(ZCTA_ZIP_PATH), { recursive: true });
  log(`downloading ${ZCTA_ZIP_URL} (~65MB, one-time)...`);
  const res = await fetch(ZCTA_ZIP_URL);
  if (!res.ok) {
    throw new Error(`ZCTA download failed: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(ZCTA_ZIP_PATH, buf);
  log(`saved ${ZCTA_ZIP_PATH} (${(buf.length / 1e6).toFixed(1)} MB)`);
}

function ensureFlZctaGeojson(force: boolean): void {
  if (existsSync(ZCTA_FL_GEOJSON_PATH) && !force) {
    log(`using cached ${ZCTA_FL_GEOJSON_PATH}`);
    return;
  }
  log('filtering nationwide ZCTA file to FL prefix range via mapshaper...');
  // Shell out to the mapshaper CLI (devDependency) rather than its
  // undocumented programmatic API. Reprojects to WGS84 (source is NAD83 —
  // negligible difference for area-share math, but turf assumes lon/lat)
  // and keeps only the ZIP code field.
  execFileSync(
    'npx',
    [
      'mapshaper',
      '-i',
      ZCTA_ZIP_PATH,
      '-proj',
      'wgs84',
      '-filter',
      '/^3[2-4]/.test(ZCTA5CE20)',
      '-each',
      'zip = ZCTA5CE20',
      '-filter-fields',
      'zip',
      '-o',
      ZCTA_FL_GEOJSON_PATH,
      'format=geojson',
      'precision=0.000001',
    ],
    { cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32' },
  );
}

function loadGeoJson(path: string): FeatureCollection {
  return JSON.parse(readFileSync(path, 'utf8')) as FeatureCollection;
}

/** Cheap axis-aligned bbox overlap test — pares down the O(zips*districts)
 * candidate set before paying for booleanIntersects / intersect. */
function bboxesOverlap(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

async function main() {
  const force = process.argv.includes('--force');

  if (!existsSync(DISTRICTS_PATH)) {
    throw new Error(
      `Missing ${DISTRICTS_PATH}. Run the EOGPCRP2026 shapefile→GeoJSON conversion first (see supabase/seed/README.md).`,
    );
  }

  await ensureZctaZip(force);
  ensureFlZctaGeojson(force);

  const districtsFc = loadGeoJson(DISTRICTS_PATH) as FeatureCollection<
    Polygon | MultiPolygon,
    { district: number; name?: string }
  >;
  const zctaFc = loadGeoJson(ZCTA_FL_GEOJSON_PATH) as FeatureCollection<
    Polygon | MultiPolygon,
    { zip: string }
  >;

  log(
    `intersecting ${zctaFc.features.length} candidate ZCTAs against ${districtsFc.features.length} districts...`,
  );

  const districts = districtsFc.features.map((f) => ({
    feature: f as Poly,
    district: f.properties!.district,
    bbox: turf.bbox(f) as BBox,
  }));

  const crosswalk: Record<string, CrosswalkEntry[]> = {};
  let processed = 0;

  for (const zctaFeature of zctaFc.features) {
    const zip = zctaFeature.properties!.zip;
    const zctaPoly = zctaFeature as Poly;
    const zctaBbox = turf.bbox(zctaFeature) as BBox;
    const zctaArea = turf.area(zctaFeature);
    if (!zctaArea || zctaArea <= 0) continue;

    const entries: CrosswalkEntry[] = [];

    for (const d of districts) {
      if (!bboxesOverlap(zctaBbox, d.bbox)) continue;
      if (!turf.booleanIntersects(zctaPoly, d.feature)) continue;

      let intersection: Feature | null = null;
      try {
        intersection = turf.intersect(
          turf.featureCollection([zctaPoly, d.feature]),
        );
      } catch {
        // Degenerate geometry (self-intersection artifacts from
        // simplification). Skip this district for this ZIP rather than
        // aborting the whole run.
        continue;
      }
      if (!intersection) continue;

      const overlapArea = turf.area(intersection);
      const share = overlapArea / zctaArea;
      if (share > NOISE_FLOOR) {
        entries.push({ district: d.district, share });
      }
    }

    if (entries.length > 0) {
      entries.sort((a, b) => b.share - a.share);
      crosswalk[zip] = entries.map((e) => ({
        district: e.district,
        share: Math.round(e.share * 10000) / 10000,
      }));
    }

    processed += 1;
    if (processed % 200 === 0) {
      log(`processed ${processed}/${zctaFc.features.length}...`);
    }
  }

  const zipCount = Object.keys(crosswalk).length;
  const splitCount = Object.values(crosswalk).filter((v) => v.length > 1)
    .length;
  log(`resolved ${zipCount} FL ZIPs (${splitCount} split across districts)`);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(crosswalk, null, 2) + '\n');
  log(`wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
