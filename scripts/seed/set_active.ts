// Set the active flag for named candidates, in fixtures and (with --db) in the database.
//
// Usage:
//   npx tsx scripts/seed/set_active.ts --slugs a,b,c --active false [--db]
//
// Without --db the script edits only supabase/seed/candidates/*.partial.json.
// With --db it also runs an UPDATE against the database via the service-role client.

import '../_env';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';
import { getAdminClient } from './supabase-admin';

const FIXTURE_DIR = CANDIDATE_FIXTURE_DIR;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const slugsArg = get('--slugs');
  const activeArg = get('--active');
  if (!slugsArg || (activeArg !== 'true' && activeArg !== 'false')) {
    console.error('Usage: set_active.ts --slugs a,b,c --active true|false [--db]');
    process.exit(1);
  }
  return {
    slugs: slugsArg.split(',').map((s) => s.trim()).filter(Boolean),
    active: activeArg === 'true',
    db: args.includes('--db'),
  };
}

function setInObject(node: unknown, slugs: Set<string>, active: boolean, hits: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) setInObject(item, slugs, active, hits);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (typeof obj.slug === 'string' && slugs.has(obj.slug) && 'active' in obj) {
      if (obj.active !== active) {
        obj.active = active;
        hits.push(obj.slug);
      }
    }
    for (const value of Object.values(obj)) setInObject(value, slugs, active, hits);
  }
}

async function main() {
  const { slugs, active, db } = parseArgs();
  const slugSet = new Set(slugs);
  const fixtureHits: Record<string, string[]> = {};

  for (const file of readdirSync(FIXTURE_DIR)) {
    if (!file.endsWith('.partial.json')) continue;
    const path = join(FIXTURE_DIR, file);
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const hits: string[] = [];
    setInObject(data, slugSet, active, hits);
    if (hits.length > 0) {
      writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
      fixtureHits[file] = hits;
    }
  }
  console.log('Fixture changes:', JSON.stringify(fixtureHits, null, 2));

  const found = new Set(Object.values(fixtureHits).flat());
  const missing = slugs.filter((s) => !found.has(s));
  if (missing.length > 0) {
    console.warn('Not changed in any fixture (absent or already at target):', missing.join(', '));
  }

  if (db) {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from('candidates')
      .update({ active })
      .in('slug', slugs)
      .select('slug, active');
    if (error) {
      console.error('DB update failed:', error.message);
      process.exit(1);
    }
    console.log('DB rows updated:', JSON.stringify(data));
    const dbSlugs = new Set((data ?? []).map((r: { slug: string }) => r.slug));
    const dbMissing = slugs.filter((s) => !dbSlugs.has(s));
    if (dbMissing.length > 0) {
      console.warn('No DB row matched:', dbMissing.join(', '));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
