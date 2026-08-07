// Build the FL ZIP -> congressional-district crosswalk for the 2026 map,
// POPULATION-weighted (2020 Census block population), not area-weighted.
//
// Why this rewrite exists: an adversarial verification pass found the old
// area-weighted crosswalk silently wrong for real voters in two ways:
//   1. A 2% AREA noise floor dropped populated slivers. Three ZIPs that are
//      genuinely split across two districts were recorded single-district
//      (33955, 32826, 33849) -- `/api/district` treats a single-entry ZIP as
//      resolved without asking for an address, so those residents got a
//      silently wrong district.
//   2. Area shares invert reality wherever an unpopulated area (an airport,
//      a park, open water) dominates a ZIP's land area but almost nobody
//      lives there. 33142 (Miami) is majority-area FL-26 (the airport) but
//      90.7% of its ~55k residents live in FL-24.
// See DATA-AUDIT-2026-08-06.md and DECISIONS-2026-08-06.md for the finding.
//
// Method: join three official 2020-Census-vintage sources at the CENSUS
// BLOCK level (the finest unit any of them publish, and the unit Congress
// actually redistricts on -- blocks are never split across districts):
//
//   (a) Block -> 2026 congressional district. The Florida Senate's official
//       EOGPCRP2026 block-equivalency file: one row per FL 2020 Census
//       block GEOID (15 digits, state+county+tract+block), 390,066 rows,
//       covering every block in the state exactly once.
//       https://www.flsenate.gov/PublishedContent/Session/Congressional/EOGPCRP2026.txt
//
//   (b) Block -> ZCTA (ZIP code). The Census Bureau's 2020 ZCTA-to-
//       tabulation-block relationship file, filtered to Florida ZCTAs
//       (32000-34999). This is a ~1GB NATIONAL file sorted ascending by
//       ZCTA5 code; rather than downloading it whole, this script binary-
//       searches (HTTP Range requests) for the FL byte range and downloads
//       only that (~50MB). Verified empirically: no FL census block is
//       split across more than one ZCTA in this file, so this is an exact
//       block->ZIP join, not an approximation.
//       https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tabblock20_natl.txt
//
//   (c) Block -> population. The 2020 Census PL 94-171 Redistricting Data
//       Summary File for Florida (the official small-area population
//       release these maps are legally drawn from). Population per block
//       lives in the geographic header file (flgeo2020.pl) at SUMLEV=750
//       rows, field POP100. Chosen over the api.census.gov PL94-171 API
//       because that API now requires a registered key (HTTP 302 ->
//       missing_key.html without one) and this direct file needs no key.
//       https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171/Florida/fl2020.pl.zip
//
// For each FL ZIP, population is summed per district across every block
// assigned to that ZIP, and share = district population / ZIP's total
// matched population. A handful of ZCTAs (verified: 5, all non-residential
// -- e.g. 32399 Tallahassee state-government complex, 32899 Kennedy Space
// Center) have zero matched population; those fall back to the OLD
// area-intersection method (turf, against the same EOGPCRP2026 district
// shapefile) and are flagged `"share_basis": "area"` per entry, per the
// verifier's required fallback.
//
// Output: `supabase/seed/zip-districts-2026.json`,
// `{ "_meta": {...}, "<zip>": [{ district, share, pop, share_basis }, ...] }`,
// sorted by descending share/population. A district is kept for a ZIP when
// it has >=0.5% population share OR >=25 residents (real slivers stay; the
// old 2% area floor is gone).
//
// Usage:
//   npx tsx scripts/ingest/build_zip_crosswalk.ts
//
// Re-run is safe: all large downloads are cached under supabase/seed/raw/
// (gitignored, machine-local) and only re-fetched if missing or with
// --force.

import '../_env';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  createReadStream,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { unzip } from 'unzipit';
import * as turf from '@turf/turf';
import type {
  BBox,
  Feature,
  FeatureCollection,
  Polygon,
  MultiPolygon,
} from 'geojson';
import type { CrosswalkMeta } from '../../src/lib/geo/types';

const REPO_ROOT = process.cwd();
const GEO_DIR = join(REPO_ROOT, 'supabase', 'seed', 'geo');
const RAW_DIR = join(REPO_ROOT, 'supabase', 'seed', 'raw');
const RAW_CENSUS_DIR = join(RAW_DIR, 'census');
const RAW_FLSENATE_DIR = join(RAW_DIR, 'flsenate');
const DISTRICTS_PATH = join(GEO_DIR, 'fl-congress-2026.geojson');
const OUT_PATH = join(REPO_ROOT, 'supabase', 'seed', 'zip-districts-2026.json');
// Build provenance lives in a SIDECAR file, not a `_meta` key inside
// zip-districts-2026.json itself. Consumers outside src/lib/geo (e.g.
// src/lib/data/races.ts) read that file as a pure `{ "<zip>": [...] }`
// map and index it directly by zip code -- a `_meta` key would collide
// with that assumption for every consumer, not just the ones in this
// module. Keeping the map pure preserves backward compatibility for all
// of them, not only the ones this rework touches.
const OUT_META_PATH = join(
  REPO_ROOT,
  'supabase',
  'seed',
  'zip-districts-2026.meta.json',
);

// (a) Block -> district (FL Senate official block-equivalency file).
const BLOCK_DISTRICT_URL =
  'https://www.flsenate.gov/PublishedContent/Session/Congressional/EOGPCRP2026.txt';
const BLOCK_DISTRICT_PATH = join(RAW_FLSENATE_DIR, 'EOGPCRP2026.txt');

// (b) Block -> ZCTA (national relationship file; we extract only the FL
// byte range via Range requests, see ensureRelationshipFlFile).
const REL_NATL_URL =
  'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tabblock20_natl.txt';
const REL_FL_PATH = join(RAW_CENSUS_DIR, 'tab20_zcta520_tabblock20_FL.txt');
// The relationship file is sorted ascending by GEOID_ZCTA5_20. FL ZCTAs
// fall in 320xx-349xx; '35000' is the first code past the FL range.
const FL_ZCTA_LOWER = '32000';
const FL_ZCTA_UPPER = '35000';

// (c) Block -> population (2020 PL 94-171 redistricting file for FL).
const PL94171_ZIP_URL =
  'https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171/Florida/fl2020.pl.zip';
const PL94171_DIR = join(RAW_CENSUS_DIR, 'pl94171');
const PL94171_ZIP_PATH = join(PL94171_DIR, 'fl2020.pl.zip');
const PL94171_GEO_ENTRY = 'flgeo2020.pl';
const PL94171_GEO_PATH = join(PL94171_DIR, 'extracted', PL94171_GEO_ENTRY);

// Area-fallback geometry inputs (only used for the handful of ZCTAs with
// zero matched population) -- same sources the pre-rework script used.
const ZCTA_ZIP_URL =
  'https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip';
const ZCTA_ZIP_PATH = join(RAW_CENSUS_DIR, 'cb_2020_us_zcta520_500k.zip');
const ZCTA_FL_GEOJSON_PATH = join(RAW_CENSUS_DIR, 'zcta-fl-prefix.geojson');

// A district is kept for a ZIP when it clears EITHER threshold. Keeps real
// slivers (a genuinely split ZIP with a small minority district) while
// dropping true noise (sub-25-person boundary artifacts in huge ZIPs).
const MIN_SHARE = 0.005; // 0.5% of the ZIP's population
const MIN_POP = 25; // residents

type Poly = Feature<Polygon | MultiPolygon>;

interface CrosswalkEntry {
  district: number;
  share: number;
  pop: number;
  share_basis: 'population' | 'area';
}

function log(msg: string): void {
  console.log(`[zip-crosswalk] ${msg}`);
}

// ---------------------------------------------------------------------
// (a) Block -> district
// ---------------------------------------------------------------------

async function ensureBlockDistrictFile(force: boolean): Promise<void> {
  if (existsSync(BLOCK_DISTRICT_PATH) && !force) {
    log(`using cached ${BLOCK_DISTRICT_PATH}`);
    return;
  }
  mkdirSync(dirname(BLOCK_DISTRICT_PATH), { recursive: true });
  log(`downloading ${BLOCK_DISTRICT_URL} (~7.6MB, one-time)...`);
  const res = await fetch(BLOCK_DISTRICT_URL);
  if (!res.ok) {
    throw new Error(`Block-equivalency download failed: HTTP ${res.status}`);
  }
  const text = await res.text();
  writeFileSync(BLOCK_DISTRICT_PATH, text);
  log(`saved ${BLOCK_DISTRICT_PATH}`);
}

async function loadBlockDistrictMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  await forEachLine(BLOCK_DISTRICT_PATH, (line) => {
    const comma = line.indexOf(',');
    if (comma === -1) return;
    const geoid = line.slice(0, comma);
    const district = Number(line.slice(comma + 1));
    map.set(geoid, district);
  });
  return map;
}

// ---------------------------------------------------------------------
// (b) Block -> ZCTA (binary-search the ~1GB national file for the FL range)
// ---------------------------------------------------------------------

async function headContentLength(url: string): Promise<number> {
  const res = await fetch(url, {
    method: 'HEAD',
    headers: { 'Accept-Encoding': 'identity' },
  });
  if (!res.ok) throw new Error(`HEAD ${url} failed: HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length'));
  if (!len) throw new Error(`HEAD ${url} returned no content-length`);
  return len;
}

/** Fetch a small window at `offset` and return the byte offset + text of
 * the first COMPLETE line inside that window (skipping a partial line at
 * the very start, unless offset===0). */
async function lineAt(
  url: string,
  offset: number,
  windowSize = 4096,
): Promise<{ line: string; lineStartOffset: number }> {
  const end = offset + windowSize;
  const res = await fetch(url, {
    headers: {
      Range: `bytes=${offset}-${end}`,
      'Accept-Encoding': 'identity',
    },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  let start = 0;
  if (offset !== 0) {
    const nl = text.indexOf('\n');
    if (nl === -1) {
      throw new Error(`window too small to find a newline at offset ${offset}`);
    }
    start = nl + 1;
  }
  const nl2 = text.indexOf('\n', start);
  const line = nl2 === -1 ? text.slice(start) : text.slice(start, nl2);
  const lineStartOffset =
    offset + Buffer.byteLength(text.slice(0, start), 'utf8');
  return { line, lineStartOffset };
}

/** Binary-search a file assumed sorted ascending by GEOID_ZCTA5_20 (field
 * index 1, pipe-delimited) for the smallest byte offset whose line's ZCTA
 * is >= `target`. */
async function findZctaLowerBound(
  url: string,
  totalLen: number,
  target: string,
): Promise<number> {
  let lo = 0;
  let hi = totalLen;
  let best = totalLen;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const { line, lineStartOffset } = await lineAt(url, mid);
    const zcta = line.split('|')[1] ?? '';
    if (zcta >= target) {
      best = lineStartOffset;
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return best;
}

async function ensureRelationshipFlFile(force: boolean): Promise<void> {
  if (existsSync(REL_FL_PATH) && !force) {
    log(`using cached ${REL_FL_PATH}`);
    return;
  }
  log(
    'locating FL byte range in the 1GB national ZCTA<->block relationship file via binary search...',
  );
  const totalLen = await headContentLength(REL_NATL_URL);
  const flStart = await findZctaLowerBound(REL_NATL_URL, totalLen, FL_ZCTA_LOWER);
  const flEnd = await findZctaLowerBound(REL_NATL_URL, totalLen, FL_ZCTA_UPPER);
  log(
    `FL range: bytes ${flStart}-${flEnd} (~${((flEnd - flStart) / 1e6).toFixed(1)}MB of ${(totalLen / 1e6).toFixed(0)}MB)`,
  );
  const res = await fetch(REL_NATL_URL, {
    headers: {
      Range: `bytes=${flStart}-${flEnd - 1}`,
      'Accept-Encoding': 'identity',
    },
  });
  if (!res.ok && res.status !== 206) {
    throw new Error(`Range download failed: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(REL_FL_PATH), { recursive: true });
  writeFileSync(REL_FL_PATH, buf);
  log(`saved ${REL_FL_PATH} (${(buf.length / 1e6).toFixed(1)} MB)`);
}

// ---------------------------------------------------------------------
// (c) Block -> population
// ---------------------------------------------------------------------

async function ensurePl94171GeoFile(force: boolean): Promise<void> {
  if (existsSync(PL94171_GEO_PATH) && !force) {
    log(`using cached ${PL94171_GEO_PATH}`);
    return;
  }
  if (!existsSync(PL94171_ZIP_PATH) || force) {
    mkdirSync(PL94171_DIR, { recursive: true });
    log(`downloading ${PL94171_ZIP_URL} (~66MB, one-time)...`);
    const res = await fetch(PL94171_ZIP_URL);
    if (!res.ok) {
      throw new Error(`PL 94-171 download failed: HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(PL94171_ZIP_PATH, buf);
    log(`saved ${PL94171_ZIP_PATH}`);
  } else {
    log(`using cached ${PL94171_ZIP_PATH}`);
  }
  log(
    `extracting only ${PL94171_GEO_ENTRY} (skipping the 3 data-segment files, ~400MB, not needed -- population lives in the geo header)...`,
  );
  const zipBuf = readFileSync(PL94171_ZIP_PATH);
  const { entries } = await unzip(zipBuf);
  const entry = entries[PL94171_GEO_ENTRY];
  if (!entry) {
    throw new Error(
      `${PL94171_GEO_ENTRY} not found in ${PL94171_ZIP_PATH}; zip contents: ${Object.keys(entries).join(', ')}`,
    );
  }
  const text = await entry.text();
  mkdirSync(dirname(PL94171_GEO_PATH), { recursive: true });
  writeFileSync(PL94171_GEO_PATH, text);
  log(`saved ${PL94171_GEO_PATH}`);
}

// PL 94-171 geo header file field layout (pipe-delimited, no header row;
// verified against the FL file -- field 3/index 2 = SUMLEV, field 10/
// index 9 = GEOCODE (full block GEOID for block-level rows), field 91/
// index 90 = POP100). SUMLEV '750' = census block.
const SUMLEV_BLOCK = '750';
const GEO_FIELD_SUMLEV = 2;
const GEO_FIELD_GEOCODE = 9;
const GEO_FIELD_POP100 = 90;

async function loadBlockPopulationMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  await forEachLine(PL94171_GEO_PATH, (line) => {
    const fields = line.split('|');
    if (fields[GEO_FIELD_SUMLEV] !== SUMLEV_BLOCK) return;
    const geoid = fields[GEO_FIELD_GEOCODE];
    const pop = Number(fields[GEO_FIELD_POP100]);
    if (geoid) map.set(geoid, pop);
  });
  return map;
}

async function forEachLine(
  path: string,
  onLine: (line: string) => void,
): Promise<void> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line) onLine(line);
  }
}

// ---------------------------------------------------------------------
// Population join: block -> district, block -> ZCTA, block -> pop
// ---------------------------------------------------------------------

interface ZipPopulation {
  totalPop: number;
  districtPop: Map<number, number>;
}

async function computePopulationJoin(
  blockDistrict: Map<string, number>,
  blockPop: Map<string, number>,
): Promise<Map<string, ZipPopulation>> {
  const zipPop = new Map<string, ZipPopulation>();
  let matchedRows = 0;
  let skippedNoDistrict = 0;

  await forEachLine(REL_FL_PATH, (line) => {
    const fields = line.split('|');
    const zip = fields[1];
    const blockGeoid = fields[9];
    if (!zip || !blockGeoid) return;
    const district = blockDistrict.get(blockGeoid);
    if (district === undefined) {
      // Block is in a FL-prefix ZCTA but not in the FL block-equivalency
      // file -- i.e. it's actually just across the state line. Excluded:
      // it isn't part of any FL district, so it can't contribute to a
      // district's share.
      skippedNoDistrict += 1;
      return;
    }
    const pop = blockPop.get(blockGeoid) ?? 0;
    matchedRows += 1;
    let entry = zipPop.get(zip);
    if (!entry) {
      entry = { totalPop: 0, districtPop: new Map() };
      zipPop.set(zip, entry);
    }
    entry.totalPop += pop;
    entry.districtPop.set(district, (entry.districtPop.get(district) ?? 0) + pop);
  });

  log(
    `population join: ${matchedRows} block/ZCTA rows matched to a district (${skippedNoDistrict} skipped -- ZCTA-adjacent blocks outside FL)`,
  );
  return zipPop;
}

// ---------------------------------------------------------------------
// Area fallback (only for ZCTAs with zero matched population)
// ---------------------------------------------------------------------

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

function bboxesOverlap(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** Old area-intersection method, run only for the ZIPs whose population
 * join found zero residents (verified: a handful of non-residential ZCTAs
 * -- airports, a state-government complex, a spaceport). */
async function computeAreaFallback(
  zipsNeedingFallback: Set<string>,
  force: boolean,
): Promise<Map<string, CrosswalkEntry[]>> {
  const result = new Map<string, CrosswalkEntry[]>();
  if (zipsNeedingFallback.size === 0) return result;

  log(
    `${zipsNeedingFallback.size} ZIP(s) have zero matched population -- falling back to area intersection for: ${[...zipsNeedingFallback].join(', ')}`,
  );

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

  const districts = districtsFc.features.map((f) => ({
    feature: f as Poly,
    district: f.properties!.district,
    bbox: turf.bbox(f) as BBox,
  }));

  for (const zctaFeature of zctaFc.features) {
    const zip = zctaFeature.properties!.zip;
    if (!zipsNeedingFallback.has(zip)) continue;

    const zctaPoly = zctaFeature as Poly;
    const zctaBbox = turf.bbox(zctaFeature) as BBox;
    const zctaArea = turf.area(zctaFeature);
    if (!zctaArea || zctaArea <= 0) continue;

    const entries: { district: number; share: number }[] = [];

    for (const d of districts) {
      if (!bboxesOverlap(zctaBbox, d.bbox)) continue;
      if (!turf.booleanIntersects(zctaPoly, d.feature)) continue;

      let intersection: Feature | null = null;
      try {
        intersection = turf.intersect(
          turf.featureCollection([zctaPoly, d.feature]),
        );
      } catch {
        continue;
      }
      if (!intersection) continue;

      const overlapArea = turf.area(intersection);
      const share = overlapArea / zctaArea;
      if (share > MIN_SHARE) {
        entries.push({ district: d.district, share });
      }
    }

    entries.sort((a, b) => b.share - a.share);
    result.set(
      zip,
      entries.map((e) => ({
        district: e.district,
        share: Math.round(e.share * 10000) / 10000,
        pop: 0,
        share_basis: 'area' as const,
      })),
    );
  }

  return result;
}

// ---------------------------------------------------------------------
// Assemble + diff against the previous file
// ---------------------------------------------------------------------

function loadOldCrosswalk(): Record<string, { district: number; share: number }[]> {
  if (!existsSync(OUT_PATH)) return {};
  try {
    const raw = JSON.parse(readFileSync(OUT_PATH, 'utf8')) as Record<
      string,
      unknown
    >;
    const out: Record<string, { district: number; share: number }[]> = {};
    for (const [zip, val] of Object.entries(raw)) {
      if (Array.isArray(val)) {
        out[zip] = val as { district: number; share: number }[];
      }
    }
    return out;
  } catch {
    return {};
  }
}

function logDiff(
  oldCrosswalk: Record<string, { district: number; share: number }[]>,
  newCrosswalk: Record<string, CrosswalkEntry[]>,
): void {
  const singleToSplit: string[] = [];
  const splitToSingle: string[] = [];
  const topDistrictChanged: string[] = [];

  for (const [zip, newEntries] of Object.entries(newCrosswalk)) {
    const oldEntries = oldCrosswalk[zip];
    if (!oldEntries || oldEntries.length === 0) continue;
    const wasSplit = oldEntries.length > 1;
    const isSplit = newEntries.length > 1;
    if (!wasSplit && isSplit) singleToSplit.push(zip);
    if (wasSplit && !isSplit) splitToSingle.push(zip);
    if (oldEntries[0].district !== newEntries[0].district) {
      topDistrictChanged.push(
        `${zip}: FL-${oldEntries[0].district} -> FL-${newEntries[0].district}`,
      );
    }
  }

  log(`--- diff vs previous ${OUT_PATH} ---`);
  log(`single -> split (${singleToSplit.length}): ${singleToSplit.join(', ') || '(none)'}`);
  log(`split -> single (${splitToSingle.length}): ${splitToSingle.join(', ') || '(none)'}`);
  log(
    `top district changed (${topDistrictChanged.length}): ${topDistrictChanged.join('; ') || '(none)'}`,
  );
}

async function main() {
  const force = process.argv.includes('--force');

  if (!existsSync(DISTRICTS_PATH)) {
    throw new Error(
      `Missing ${DISTRICTS_PATH}. Run the EOGPCRP2026 shapefile->GeoJSON conversion first (see supabase/seed/README.md).`,
    );
  }

  const oldCrosswalk = loadOldCrosswalk();

  await ensureBlockDistrictFile(force);
  await ensureRelationshipFlFile(force);
  await ensurePl94171GeoFile(force);

  log('loading block -> district map (EOGPCRP2026)...');
  const blockDistrict = await loadBlockDistrictMap();
  log(`  ${blockDistrict.size} blocks`);

  log('loading block -> population map (PL 94-171 geo header, SUMLEV=750)...');
  const blockPop = await loadBlockPopulationMap();
  log(`  ${blockPop.size} blocks`);

  log('joining block -> ZCTA -> (district, population)...');
  const zipPop = await computePopulationJoin(blockDistrict, blockPop);
  log(`  ${zipPop.size} ZIPs with matched population data`);

  const zipsNeedingFallback = new Set<string>();
  for (const [zip, entry] of zipPop) {
    if (entry.totalPop === 0) zipsNeedingFallback.add(zip);
  }
  // Also cover any FL ZCTA present in the geometry universe but entirely
  // absent from the population join (defensive -- not expected given the
  // sources agree on 1,013 ZIPs, but don't silently drop a ZIP if a future
  // Census refresh disagrees).
  if (existsSync(ZCTA_FL_GEOJSON_PATH)) {
    const zctaFc = loadGeoJson(ZCTA_FL_GEOJSON_PATH) as FeatureCollection<
      Polygon | MultiPolygon,
      { zip: string }
    >;
    for (const f of zctaFc.features) {
      const zip = f.properties!.zip;
      if (!zipPop.has(zip)) zipsNeedingFallback.add(zip);
    }
  }

  const areaFallback = await computeAreaFallback(zipsNeedingFallback, force);

  const crosswalk: Record<string, CrosswalkEntry[]> = {};

  for (const [zip, entry] of zipPop) {
    if (entry.totalPop === 0) continue; // handled by area fallback below
    const all = [...entry.districtPop.entries()].map(([district, pop]) => ({
      district,
      pop,
      share: pop / entry.totalPop,
    }));
    const kept = all.filter((e) => e.share >= MIN_SHARE || e.pop >= MIN_POP);
    kept.sort((a, b) => b.pop - a.pop);
    crosswalk[zip] = kept.map((e) => ({
      district: e.district,
      share: Math.round(e.share * 10000) / 10000,
      pop: e.pop,
      share_basis: 'population' as const,
    }));
  }

  for (const [zip, entries] of areaFallback) {
    if (entries.length > 0) crosswalk[zip] = entries;
  }

  const zipCount = Object.keys(crosswalk).length;
  const splitCount = Object.values(crosswalk).filter((v) => v.length > 1).length;
  const areaFallbackCount = [...areaFallback.values()].filter(
    (v) => v.length > 0,
  ).length;
  log(
    `resolved ${zipCount} FL ZIPs (${splitCount} split across districts, ${areaFallbackCount} on the area-share fallback)`,
  );

  logDiff(oldCrosswalk, crosswalk);

  const meta: CrosswalkMeta = {
    sources: [
      'FL Senate EOGPCRP2026 block-equivalency file (block -> 2026 congressional district): https://www.flsenate.gov/PublishedContent/Session/Congressional/EOGPCRP2026.txt',
      'Census 2020 ZCTA5-to-tabulation-block relationship file (block -> ZIP), FL byte range: https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tabblock20_natl.txt',
      'Census 2020 PL 94-171 Redistricting Data Summary File for Florida (block -> population, geo header SUMLEV=750/POP100): https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171/Florida/fl2020.pl.zip',
      'Census cartographic-boundary ZCTA5 file (area-fallback geometry only, for zero-population ZCTAs): https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip',
    ],
    build_date: new Date().toISOString().slice(0, 10),
    share_basis:
      'population (2020 Census block population, summed per district per ZIP); "area" fallback (2020 ZCTA land-area intersection) only for ZCTAs with zero matched population -- see share_basis on each entry',
    min_share_threshold: MIN_SHARE,
    min_pop_threshold: MIN_POP,
    zip_count: zipCount,
    split_zip_count: splitCount,
    area_fallback_zip_count: areaFallbackCount,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(crosswalk, null, 2) + '\n');
  log(`wrote ${OUT_PATH}`);

  writeFileSync(OUT_META_PATH, JSON.stringify(meta, null, 2) + '\n');
  log(`wrote ${OUT_META_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
