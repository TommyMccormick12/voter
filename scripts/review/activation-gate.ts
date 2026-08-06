// Pure, DB-free activation-gate logic.
//
// T12 (2026-08-06, SPEC-2026-08-06.md §B4 / TICKETS-2026-08-06.md T12):
// activation must mechanically enforce hard gates before a candidate
// fixture can be marked active — no warnings, no "looks fine" defaults.
// Every function here is side-effect-free (no fs, no network, no
// Supabase) so the rules are unit-testable without a database. See
// tests/activation-gate.test.ts.
//
// Consumers:
//   - scripts/review/activate_candidate.ts — runs all three gates below
//     before flipping a fixture candidate to active=true.
//   - scripts/seed/seed-validation.ts — imports VERIFICATION_FRESHNESS_DAYS
//     and isVerifiedFresh directly from this file (not re-implemented) so
//     the activation-time stamp and the seed-time freshness check can
//     never drift out of sync. See the comment there for why the freshness
//     rule's real enforcement point is seed time, not activation time.

export interface SpineRow {
  doe_acct_num: string;
  doe_name: string;
  office: string;
  district: string | null;
  party: string;
  status: string;
  campaign_website: string | null;
  fec_candidate_id: string | null;
  join_note: string | null;
}

/** Candidacy statuses on the DOE spine that permit activation (spec B4). */
const ACCEPTED_CANDIDACY_STATUSES = new Set(['Qualified', 'Unopposed']);

const MIN_STANCES = 3;

/**
 * Freshness window (days) for candidates.verified_at (migration 011).
 *
 * Single named constant, imported everywhere the freshness rule is
 * enforced. Do not fork this number — scripts/seed/seed-validation.ts
 * imports it from here rather than redeclaring it.
 */
export const VERIFICATION_FRESHNESS_DAYS = 14;

/** Ticket B4: "≥3 stances (top_stances) present" — a hard, mechanical count. */
export function hasSufficientStances(
  topStances: unknown,
  min: number = MIN_STANCES
): boolean {
  return Array.isArray(topStances) && topStances.length >= min;
}

/**
 * Normalize a name for the identity fallback match (the no-FEC-id path).
 * Lowercases, strips diacritics, drops punctuation, collapses whitespace.
 *
 * Intentionally an exact-match normalizer, not a fuzzy one — the spine
 * and fixtures come from the same DOE/FEC pipeline, so an exact
 * normalized match is the mechanical, deterministic rule the gate needs.
 * FEC-id matching is preferred precisely because *display* names can
 * legitimately differ even for the same person/filing — e.g. fixture
 * "Angela Nixon" vs DOE roster "Angie Nixon", same fec_candidate_id
 * S6FL00830 (see supabase/seed/spine-2026.json). The name+district
 * fallback is used only when no FEC id exists on the candidate.
 */
export function normalizeIdentityName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // punctuation -> space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a district value for comparison. "09" and "9" compare equal;
 * null/undefined/'' stay null (statewide races — e.g. U.S. Senate).
 */
export function normalizeDistrict(
  district: string | null | undefined
): string | null {
  if (district === null || district === undefined || district === '') return null;
  const n = Number.parseInt(district, 10);
  return Number.isNaN(n) ? district.trim() : String(n);
}

export interface CandidacyCheckInput {
  name: string;
  fecCandidateId: string | null | undefined;
  office: string;
  district: string | null | undefined;
}

export interface CandidacyCheckResult {
  ok: boolean;
  reason: string;
  matchedVia?: 'fec_id' | 'name_district';
  matchedRow?: SpineRow;
}

/**
 * Ticket B4 candidacy check: the candidate's identity (FEC id, or
 * name+district when FEC id is null) must appear with status Qualified
 * or Unopposed in the spine, FOR EXACTLY THE RACE BEING ACTIVATED (office
 * + district must also match) — an FEC filing alone is not proof of
 * candidacy (DATA-AUDIT-2026-08-06 root cause 2: Rubio/Scott/Grayson
 * were all live FEC filers who were not actually running in the seeded
 * race).
 */
export function checkCandidacyStatus(
  candidate: CandidacyCheckInput,
  spine: SpineRow[]
): CandidacyCheckResult {
  const raceRows = spine.filter(
    (row) =>
      row.office === candidate.office &&
      normalizeDistrict(row.district) === normalizeDistrict(candidate.district)
  );

  let matches: SpineRow[];
  let matchedVia: 'fec_id' | 'name_district';

  if (candidate.fecCandidateId) {
    matches = raceRows.filter(
      (row) => row.fec_candidate_id === candidate.fecCandidateId
    );
    matchedVia = 'fec_id';
  } else {
    const target = normalizeIdentityName(candidate.name);
    matches = raceRows.filter(
      (row) => normalizeIdentityName(row.doe_name) === target
    );
    matchedVia = 'name_district';
  }

  if (matches.length === 0) {
    const raceDesc = `${candidate.office} district ${candidate.district ?? '(statewide)'}`;
    return {
      ok: false,
      reason: candidate.fecCandidateId
        ? `No spine row with fec_candidate_id "${candidate.fecCandidateId}" found for ${raceDesc}.`
        : `No spine row named "${candidate.name}" found for ${raceDesc} (fec_candidate_id was null on this candidate, so the fallback name+district match was used).`,
    };
  }

  const qualified = matches.find((row) => ACCEPTED_CANDIDACY_STATUSES.has(row.status));
  if (!qualified) {
    const statuses = [...new Set(matches.map((m) => m.status))].join(', ');
    return {
      ok: false,
      reason: `Spine row(s) matched but none has an accepted status (found: ${statuses}; need one of ${[...ACCEPTED_CANDIDACY_STATUSES].join(', ')}).`,
      matchedVia,
    };
  }

  return {
    ok: true,
    reason: 'Matched a Qualified/Unopposed spine row for this race.',
    matchedVia,
    matchedRow: qualified,
  };
}

/**
 * Freshness check for candidates.verified_at (migration 011). Missing
 * verified_at is always stale. `now` is an explicit parameter (never
 * `new Date()` read internally) so callers and tests fully control the
 * clock.
 */
export function isVerifiedFresh(
  verifiedAt: string | null | undefined,
  now: Date,
  windowDays: number = VERIFICATION_FRESHNESS_DAYS
): boolean {
  if (!verifiedAt) return false;
  const verifiedTime = new Date(verifiedAt).getTime();
  if (Number.isNaN(verifiedTime)) return false;
  const ageMs = now.getTime() - verifiedTime;
  if (ageMs < 0) return false; // a future timestamp is bogus, not "fresh"
  return ageMs <= windowDays * 24 * 60 * 60 * 1000;
}
