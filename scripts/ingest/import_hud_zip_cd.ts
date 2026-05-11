// Generate supabase/seed/zip-districts.json from the HUD USPS-ZIP-to-CD
// crosswalk file. Replaces the ~50-zip hand-mapped fallback with national
// coverage (~3,400 FL zips, ~40k total US zips per release).
//
// Why this exists:
//   The Census Geocoder doesn't accept bare zips (see plan §15.5b). HUD
//   publishes a quarterly USPS_ZIP_CROSSWALK file mapping each zip to the
//   Congressional District(s) it overlaps, with population ratios per CD.
//   The file is XLSX, behind a free-account login on huduser.gov, so this
//   script consumes a locally-downloaded file rather than fetching live.
//
// Download steps (one-time, quarterly refresh):
//   1. https://www.huduser.gov/portal/datasets/usps_crosswalk.html
//   2. Sign in (free account), pick the latest quarterly ZIP→CD file.
//   3. Save the .xlsx to disk.
//   4. Run this script with --file path/to/ZIP_CD_NNYYYY.xlsx
//
// CD encoding: HUD uses 4-digit `CD` = state_fips(2) + cd_num(2).
//   FL state_fips = 12, so CD = '1210' → FL-10.
//
// When a zip straddles multiple districts, we pick the row with the
// highest `TOT_RATIO` (residential + business + other share). Ties are
// broken by alphabetical CD code — deterministic, but rare enough that
// it doesn't matter in practice.

import '../_env';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { read, utils } from 'xlsx';

interface Args {
  file: string;
  states: string[];
  output: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let file = '';
  let states = ['FL'];
  let output = join(process.cwd(), 'supabase', 'seed', 'zip-districts.json');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') file = args[++i] ?? '';
    else if (args[i] === '--states') states = (args[++i] ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (args[i] === '--output') output = args[++i] ?? output;
  }
  if (!file) {
    console.error(
      'Usage: --file path/to/ZIP_CD_<period>.xlsx [--states FL,GA] [--output path/to/zip-districts.json]',
    );
    process.exit(1);
  }
  return { file, states, output };
}

// FIPS code → 2-letter state. Only the codes we actually expand into get
// populated; everything else maps to "??" and the script skips those rows.
const FIPS_TO_STATE: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO',
  '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI',
  '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
  '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY',
};

interface Row {
  ZIP: string | number;
  CD: string | number;
  USPS_ZIP_PREF_STATE?: string;
  TOT_RATIO?: string | number;
}

/**
 * Parse HUD's 4-digit CD code into (state, district). Returns null when
 * the state_fips doesn't map to a 2-letter code we cover.
 */
function decodeCd(cdRaw: string | number): { state: string; district: string } | null {
  const cd = String(cdRaw).padStart(4, '0');
  const fips = cd.slice(0, 2);
  const districtNum = cd.slice(2, 4);
  const state = FIPS_TO_STATE[fips];
  if (!state) return null;
  // CD "00" means at-large (single-district state) — encode as district '01'
  // for consistency with our race-id convention (race-wy-01-r-2026).
  const district = districtNum === '00' ? '01' : districtNum;
  return { state, district };
}

async function main() {
  const { file, states, output } = parseArgs();
  if (!existsSync(file)) {
    console.error(`[hud-zip-cd] file not found: ${file}`);
    process.exit(1);
  }
  const stateSet = new Set(states);
  console.log(`[hud-zip-cd] loading ${file}`);
  const workbook = read(readFileSync(file));
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = utils.sheet_to_json<Row>(sheet);
  console.log(`[hud-zip-cd] ${rows.length} rows in sheet "${sheetName}"`);

  // Group rows by zip; pick the row with the highest TOT_RATIO per zip.
  const winnerByZip = new Map<
    string,
    { state: string; district: string; ratio: number; cdRaw: string }
  >();
  let skippedNoDecode = 0;
  let skippedOutOfScope = 0;
  for (const row of rows) {
    const decoded = decodeCd(row.CD);
    if (!decoded) {
      skippedNoDecode++;
      continue;
    }
    if (!stateSet.has(decoded.state)) {
      skippedOutOfScope++;
      continue;
    }
    const zip = String(row.ZIP).padStart(5, '0');
    const ratio = typeof row.TOT_RATIO === 'number' ? row.TOT_RATIO : parseFloat(String(row.TOT_RATIO ?? '0'));
    const cdRaw = String(row.CD).padStart(4, '0');
    const incumbent = winnerByZip.get(zip);
    if (
      !incumbent ||
      ratio > incumbent.ratio ||
      (ratio === incumbent.ratio && cdRaw < incumbent.cdRaw)
    ) {
      winnerByZip.set(zip, { ...decoded, ratio, cdRaw });
    }
  }

  // Preserve any existing _note entries in the output file (e.g. the
  // legacy 50-zip hand map's documentation key). They'll be overridden
  // by real zip lookups but kept for any keys we don't touch.
  let existing: Record<string, unknown> = {};
  if (existsSync(output)) {
    try {
      existing = JSON.parse(readFileSync(output, 'utf8'));
    } catch {
      existing = {};
    }
  }

  const merged: Record<string, { state: string; district: string } | unknown> = {
    ...existing,
  };
  for (const [zip, { state, district }] of winnerByZip) {
    merged[zip] = { state, district };
  }

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(merged, null, 2));
  const districtCounts = new Map<string, number>();
  for (const v of winnerByZip.values()) {
    districtCounts.set(`${v.state}-${v.district}`, (districtCounts.get(`${v.state}-${v.district}`) ?? 0) + 1);
  }
  console.log(
    `[hud-zip-cd] wrote ${winnerByZip.size} zip → district entries to ${output}`,
  );
  console.log(
    `[hud-zip-cd] skipped: ${skippedNoDecode} unknown state_fips, ${skippedOutOfScope} out-of-scope states`,
  );
  console.log(
    `[hud-zip-cd] district coverage: ${districtCounts.size} unique CDs`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
