// Build a ZIP → Congressional District map for a list of zips.
// Output: supabase/seed/zip-districts.json
//
// Usage:
//   npx tsx scripts/ingest/fetch_zip_districts.ts --zips 07059,07924,08807
//
// Or pass a path to a newline-delimited zip file:
//   npx tsx scripts/ingest/fetch_zip_districts.ts --zips-file zips.txt

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { zipToDistrict } from '../../src/lib/api-clients/census';
import { REPO_ROOT } from '../../src/lib/api-clients/base';

interface Args {
  zips: string[];
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let zips: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--zips') {
      zips = (args[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (args[i] === '--zips-file') {
      const path = args[++i] ?? '';
      zips = readFileSync(path, 'utf8')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  if (zips.length === 0) {
    console.error('Usage: --zips 07059,07924 OR --zips-file path/to/zips.txt');
    process.exit(1);
  }
  return { zips };
}

async function main() {
  const { zips } = parseArgs();
  const outPath = join(REPO_ROOT, 'supabase', 'seed', 'zip-districts.json');
  let map: Record<string, { state: string; district: string } | null> = {};
  if (existsSync(outPath)) {
    map = JSON.parse(readFileSync(outPath, 'utf8'));
  }

  for (const zip of zips) {
    if (zip in map) {
      console.log(`[census] ${zip} cached`);
      continue;
    }
    try {
      const result = await zipToDistrict(zip);
      if (result) {
        map[zip] = { state: result.state, district: result.district };
        console.log(`[census] ${zip} → ${result.state}-${result.district}`);
      } else {
        map[zip] = null;
        console.log(`[census] ${zip} → no district`);
      }
    } catch (err) {
      console.warn(`[census] ${zip} failed:`, err instanceof Error ? err.message : err);
      map[zip] = null;
    }
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(map, null, 2));
  console.log(`[census] wrote ${outPath} (${Object.keys(map).length} zips)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
