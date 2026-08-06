// Mark a single candidate as activation-approved by promoting them out
// of the .partial.json fixture. Operates on local fixtures; the actual
// flip of candidates.active=true happens at seed time when the fixture
// is loaded into Supabase.
//
// T12 (2026-08-06, SPEC-2026-08-06.md §B4): activation now enforces three
// mechanical hard gates before a candidate can be marked active — no
// warnings, no silent pass-through. Any gate failure exits non-zero and
// leaves the fixture file untouched:
//   1. >=3 top_stances (hasSufficientStances).
//   2. DOE spine candidacy check — the candidate's FEC id (or name+district
//      when FEC id is null) must appear as Qualified/Unopposed in
//      supabase/seed/spine-2026.json for exactly this race. An FEC filing
//      alone is not proof of candidacy (DATA-AUDIT-2026-08-06 root cause 2).
//   3. Stamps candidates.verified_at = now (migration 011). See the
//      mechanism note below the gates for why the accompanying freshness
//      check here is a defensive assertion rather than the rule's real
//      enforcement point.
//
// All three rules are pure functions in ./activation-gate, unit-tested
// without a DB in tests/activation-gate.test.ts.
//
// Usage:
//   npx tsx scripts/review/activate_candidate.ts \
//     --race-id race-nj-07-r-2026 --slug thomas-kean-jr

import '../_env';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CANDIDATE_FIXTURE_DIR, REPO_ROOT } from '../../src/lib/api-clients/base';
import {
  hasSufficientStances,
  checkCandidacyStatus,
  isVerifiedFresh,
  VERIFICATION_FRESHNESS_DAYS,
  type SpineRow,
} from './activation-gate';

interface Args {
  raceId: string;
  slug: string;
}

const SPINE_PATH = join(REPO_ROOT, 'supabase', 'seed', 'spine-2026.json');

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId = '';
  let slug = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
    if (args[i] === '--slug') slug = args[++i] ?? '';
  }
  if (!raceId || !slug) {
    console.error('Usage: --race-id "..." --slug "candidate-slug"');
    process.exit(1);
  }
  return { raceId, slug };
}

function loadSpine(): SpineRow[] {
  if (!existsSync(SPINE_PATH)) {
    console.error(
      `[activate] Spine file missing: ${SPINE_PATH}. Run scripts/ingest/fetch_doe_roster.ts first (T02) — activation cannot proceed without it.`
    );
    process.exit(1);
  }
  return JSON.parse(readFileSync(SPINE_PATH, 'utf8')) as SpineRow[];
}

function main() {
  const { raceId, slug } = parseArgs();
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`Partial fixture missing: ${partialPath}`);
    process.exit(1);
  }
  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const candidate = fixture.candidates?.find(
    (c: { slug?: string }) => c.slug === slug
  );
  if (!candidate) {
    console.error(`Candidate slug "${slug}" not found in fixture.`);
    process.exit(1);
  }

  // --- Gate 1: >=3 stances (mechanical, hard failure) ---
  if (!hasSufficientStances(candidate.top_stances)) {
    const count = Array.isArray(candidate.top_stances)
      ? candidate.top_stances.length
      : 0;
    console.error(
      `[activate] REFUSED: ${candidate.name} (${slug}) has ${count} top_stances; activation requires >= 3. Fixture NOT modified.`
    );
    process.exit(1);
  }

  // --- Gate 2: DOE spine candidacy check (mechanical, hard failure) ---
  const spine = loadSpine();
  const candidacy = checkCandidacyStatus(
    {
      name: candidate.name,
      fecCandidateId: candidate.fec_candidate_id ?? null,
      office: candidate.office ?? fixture.race?.office,
      district: candidate.district ?? fixture.race?.district ?? null,
    },
    spine
  );
  if (!candidacy.ok) {
    console.error(
      `[activate] REFUSED: ${candidate.name} (${slug}) failed the DOE spine candidacy check: ${candidacy.reason} Fixture NOT modified.`
    );
    process.exit(1);
  }

  // --- Gate 3: stamp verified_at ---
  //
  // Mechanism note: the freshness assertion right below is a defensive
  // invariant, not a real decision point. We just computed `now` and
  // stamp verified_at = now, so isVerifiedFresh(verifiedAtIso, now) is
  // true by construction (age 0 <= VERIFICATION_FRESHNESS_DAYS). It's
  // asserted anyway so the exact same predicate that gates
  // seed_candidates.ts (scripts/seed/seed-validation.ts, which imports
  // isVerifiedFresh from ./activation-gate rather than reimplementing it)
  // is also checked here at write time — if it were ever false, that
  // means clock skew or a bug, and we'd rather crash loudly here than
  // write a verified_at that seed_candidates.ts would immediately reject.
  //
  // The freshness rule's REAL enforcement point is seed time (T12 item
  // 4, scripts/seed/seed_candidates.ts): a reviewed-and-activated fixture
  // can sit unseeded for days or weeks, and that gate is what actually
  // keeps a stale review out of production.
  const now = new Date();
  const verifiedAtIso = now.toISOString();
  if (!isVerifiedFresh(verifiedAtIso, now, VERIFICATION_FRESHNESS_DAYS)) {
    console.error(
      '[activate] REFUSED: freshness self-check failed immediately after stamping verified_at (clock issue?). Fixture NOT modified.'
    );
    process.exit(1);
  }

  candidate.active = true;
  candidate.activated_at = verifiedAtIso;
  candidate.verified_at = verifiedAtIso;
  writeFileSync(partialPath, JSON.stringify(fixture, null, 2));
  console.log(
    `[activate] ${candidate.name} marked active in ${partialPath} (matched spine via ${candidacy.matchedVia}, verified_at=${verifiedAtIso})`
  );
}

main();
