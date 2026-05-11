// One-shot: apply the §18.2 Mc/Mac/O' fixes to candidate names already
// title-cased by the older normalizeFecName. Re-running ingest:fec
// doesn't help (the seed guard skips when candidates exist), so this
// targets the post-pass directly.
//
// Idempotent. Safe to re-run.

import './_env';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CANDIDATE_FIXTURE_DIR } from '../src/lib/api-clients/base';

/** Apply only the surname-prefix post-pass (matches names.ts toTitleCase). */
function fixSurnamePrefixes(name: string): string {
  let out = name;
  out = out.replace(/\bMc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`);
  out = out.replace(
    /\bMac([a-z])([a-z]{3,})/g,
    (_, c, rest) => `Mac${c.toUpperCase()}${rest}`,
  );
  out = out.replace(/\bO'([a-z])/g, (_, c) => `O'${c.toUpperCase()}`);
  return out;
}

interface Candidate { name?: string; slug?: string }
interface Fixture { candidates?: Candidate[] }

function main() {
  const files = readdirSync(CANDIDATE_FIXTURE_DIR).filter(
    (f) => f.endsWith('.partial.json'),
  );
  let totalCandidates = 0;
  let totalChanged = 0;
  for (const f of files) {
    const path = join(CANDIDATE_FIXTURE_DIR, f);
    const fixture: Fixture = JSON.parse(readFileSync(path, 'utf8'));
    const cands = fixture.candidates ?? [];
    let changed = 0;
    for (const c of cands) {
      if (!c.name) continue;
      const fixed = fixSurnamePrefixes(c.name);
      if (fixed !== c.name) {
        console.log(`  ${f}: ${c.name} → ${fixed}`);
        c.name = fixed;
        changed++;
        // Don't re-slug — slugs are stable IDs and changing them would
        // orphan any Supabase rows already keyed against them.
      }
    }
    totalCandidates += cands.length;
    totalChanged += changed;
    if (changed > 0) {
      writeFileSync(path, JSON.stringify(fixture, null, 2));
    }
  }
  console.log(`\n[fixup-names] scanned ${files.length} fixtures, ${totalCandidates} candidates, fixed ${totalChanged} names.`);
}

main();
