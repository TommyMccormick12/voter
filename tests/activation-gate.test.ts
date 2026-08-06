// Tests for the pure activation-gate logic (scripts/review/activation-gate.ts).
// T12 (2026-08-06, SPEC-2026-08-06.md §B4, TICKETS-2026-08-06.md T12).
//
// No DB, no fs — every rule under test is a pure function operating on
// plain data, per the ticket's "extract pure functions so they are
// testable without a DB" instruction.

import { describe, it, expect } from 'vitest';
import {
  hasSufficientStances,
  normalizeIdentityName,
  normalizeDistrict,
  checkCandidacyStatus,
  isVerifiedFresh,
  VERIFICATION_FRESHNESS_DAYS,
  type SpineRow,
} from '../scripts/review/activation-gate';

function spineRow(overrides: Partial<SpineRow> = {}): SpineRow {
  return {
    doe_acct_num: '00000',
    doe_name: 'Jane Doe',
    office: 'U.S. House',
    district: '10',
    party: 'DEM',
    status: 'Qualified',
    campaign_website: null,
    fec_candidate_id: 'H6FL10000',
    join_note: null,
    ...overrides,
  };
}

describe('hasSufficientStances', () => {
  it('passes with exactly 3 stances', () => {
    expect(hasSufficientStances([1, 2, 3])).toBe(true);
  });

  it('passes with more than 3 stances', () => {
    expect(hasSufficientStances([1, 2, 3, 4, 5])).toBe(true);
  });

  it('fails with fewer than 3 stances', () => {
    expect(hasSufficientStances([1, 2])).toBe(false);
  });

  it('fails with zero stances', () => {
    expect(hasSufficientStances([])).toBe(false);
  });

  it('fails when top_stances is missing/undefined', () => {
    expect(hasSufficientStances(undefined)).toBe(false);
  });

  it('fails when top_stances is not an array', () => {
    expect(hasSufficientStances('not an array')).toBe(false);
    expect(hasSufficientStances(null)).toBe(false);
    expect(hasSufficientStances({})).toBe(false);
  });

  it('respects a custom minimum', () => {
    expect(hasSufficientStances([1, 2, 3, 4], 5)).toBe(false);
    expect(hasSufficientStances([1, 2, 3, 4, 5], 5)).toBe(true);
  });
});

describe('normalizeIdentityName', () => {
  it('lowercases and trims', () => {
    expect(normalizeIdentityName('  Jane DOE  ')).toBe('jane doe');
  });

  it('strips diacritics', () => {
    expect(normalizeIdentityName('José García')).toBe('jose garcia');
  });

  it('strips punctuation (periods, commas, apostrophes) to spaces', () => {
    // Apostrophes become a space like any other punctuation — "O'Brien"
    // normalizes to "o brien", not "obrien". This is fine: both sides of
    // any real comparison (spine doe_name vs. fixture name) go through
    // the same normalizer, so it stays internally consistent.
    expect(normalizeIdentityName("V. Michael O'Brien, Jr.")).toBe('v michael o brien jr');
  });

  it('collapses repeated whitespace', () => {
    expect(normalizeIdentityName('Jane   Q   Doe')).toBe('jane q doe');
  });

  it('preserves hyphens as separate tokens (space-joined)', () => {
    // Hyphens are punctuation under this normalizer, same as the rest —
    // deterministic and simple beats a bespoke hyphen rule here.
    expect(normalizeIdentityName('Cherfilus-McCormick')).toBe('cherfilus mccormick');
  });
});

describe('normalizeDistrict', () => {
  it('treats zero-padded and bare digits as equal', () => {
    expect(normalizeDistrict('09')).toBe(normalizeDistrict('9'));
    expect(normalizeDistrict('09')).toBe('9');
  });

  it('treats null, undefined, and empty string as the same (statewide) value', () => {
    expect(normalizeDistrict(null)).toBeNull();
    expect(normalizeDistrict(undefined)).toBeNull();
    expect(normalizeDistrict('')).toBeNull();
  });

  it('leaves a non-numeric district as trimmed text', () => {
    expect(normalizeDistrict(' AL ')).toBe('AL');
  });
});

describe('checkCandidacyStatus', () => {
  const raceOffice = 'U.S. House';
  const raceDistrict = '11';

  it('passes when fec_candidate_id matches a Qualified spine row in the same race', () => {
    const spine = [
      spineRow({ doe_name: 'Carey Baker', office: raceOffice, district: raceDistrict, fec_candidate_id: 'H6FL11340', status: 'Qualified' }),
    ];
    const result = checkCandidacyStatus(
      { name: 'Carey Baker', fecCandidateId: 'H6FL11340', office: raceOffice, district: raceDistrict },
      spine
    );
    expect(result.ok).toBe(true);
    expect(result.matchedVia).toBe('fec_id');
  });

  it('passes via fec_candidate_id even when display names differ (Angie Nixon / Angela Nixon regression)', () => {
    const spine = [
      spineRow({ doe_name: 'Angie Nixon', office: 'U.S. Senate', district: null, fec_candidate_id: 'S6FL00830', status: 'Qualified' }),
    ];
    const result = checkCandidacyStatus(
      { name: 'Angela Nixon', fecCandidateId: 'S6FL00830', office: 'U.S. Senate', district: null },
      spine
    );
    expect(result.ok).toBe(true);
    expect(result.matchedVia).toBe('fec_id');
  });

  it('accepts Unopposed status, not only Qualified', () => {
    const spine = [
      spineRow({ doe_name: 'Maxwell Frost', office: raceOffice, district: '10', fec_candidate_id: 'H2FL10259', status: 'Unopposed' }),
    ];
    const result = checkCandidacyStatus(
      { name: 'Maxwell Frost', fecCandidateId: 'H2FL10259', office: raceOffice, district: '10' },
      spine
    );
    expect(result.ok).toBe(true);
  });

  it('fails a real FEC filer who withdrew / is not in this race (Rick Scott class)', () => {
    // Scott has no spine row for a House race even if some FEC id exists.
    const spine = [spineRow({ doe_name: 'Someone Else', office: raceOffice, district: raceDistrict, fec_candidate_id: 'H0OTHER' })];
    const result = checkCandidacyStatus(
      { name: 'Rick Scott', fecCandidateId: 'S6FL00640', office: raceOffice, district: raceDistrict },
      spine
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no spine row/i);
  });

  it('falls back to name+district match when fec_candidate_id is null', () => {
    const spine = [
      spineRow({ doe_name: 'Neil J. Gillespie', office: 'U.S. Senate', district: null, fec_candidate_id: null, status: 'Qualified' }),
    ];
    const result = checkCandidacyStatus(
      { name: 'Neil J. Gillespie', fecCandidateId: null, office: 'U.S. Senate', district: null },
      spine
    );
    expect(result.ok).toBe(true);
    expect(result.matchedVia).toBe('name_district');
  });

  it('name+district fallback is normalized-exact, not fuzzy — a mismatched name fails', () => {
    const spine = [
      spineRow({ doe_name: 'Neil J. Gillespie', office: 'U.S. Senate', district: null, fec_candidate_id: null, status: 'Qualified' }),
    ];
    const result = checkCandidacyStatus(
      { name: 'Neil Gillespie', fecCandidateId: null, office: 'U.S. Senate', district: null },
      spine
    );
    expect(result.ok).toBe(false);
  });

  it('requires the SAME race (office+district) — same person qualified elsewhere does not count', () => {
    // DATA-AUDIT: Grayson failed to qualify for Senate but is qualified in FL-7.
    const spine = [
      spineRow({ doe_name: 'Alan Mark Grayson', office: 'U.S. House', district: '07', fec_candidate_id: 'S2FL00581', status: 'Qualified' }),
    ];
    const result = checkCandidacyStatus(
      { name: 'Alan Mark Grayson', fecCandidateId: 'S2FL00581', office: 'U.S. Senate', district: null },
      spine
    );
    expect(result.ok).toBe(false);
  });

  it('matches districts regardless of zero-padding', () => {
    const spine = [
      spineRow({ doe_name: 'Deborah Adeimy', office: raceOffice, district: '09', fec_candidate_id: 'H2FL21132', status: 'Qualified' }),
    ];
    const result = checkCandidacyStatus(
      { name: 'Deborah Adeimy', fecCandidateId: 'H2FL21132', office: raceOffice, district: '9' },
      spine
    );
    expect(result.ok).toBe(true);
  });

  it('fails when the only matching row has a non-accepted status', () => {
    const spine = [
      spineRow({ doe_name: 'Withdrawn Person', office: raceOffice, district: raceDistrict, fec_candidate_id: 'H1WITHDRAWN', status: 'Withdrawn' }),
    ];
    const result = checkCandidacyStatus(
      { name: 'Withdrawn Person', fecCandidateId: 'H1WITHDRAWN', office: raceOffice, district: raceDistrict },
      spine
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/none has an accepted status/i);
  });
});

describe('isVerifiedFresh', () => {
  const now = new Date('2026-08-06T12:00:00Z');

  it('fails when verified_at is missing', () => {
    expect(isVerifiedFresh(undefined, now)).toBe(false);
    expect(isVerifiedFresh(null, now)).toBe(false);
    expect(isVerifiedFresh('', now)).toBe(false);
  });

  it('fails when verified_at is not a parseable date', () => {
    expect(isVerifiedFresh('not-a-date', now)).toBe(false);
  });

  it('passes when verified_at is now', () => {
    expect(isVerifiedFresh(now.toISOString(), now)).toBe(true);
  });

  it(`passes at exactly the ${VERIFICATION_FRESHNESS_DAYS}-day boundary`, () => {
    const boundary = new Date(now.getTime() - VERIFICATION_FRESHNESS_DAYS * 24 * 60 * 60 * 1000);
    expect(isVerifiedFresh(boundary.toISOString(), now, VERIFICATION_FRESHNESS_DAYS)).toBe(true);
  });

  it('fails just past the freshness window', () => {
    const justStale = new Date(
      now.getTime() - VERIFICATION_FRESHNESS_DAYS * 24 * 60 * 60 * 1000 - 1000
    );
    expect(isVerifiedFresh(justStale.toISOString(), now, VERIFICATION_FRESHNESS_DAYS)).toBe(false);
  });

  it('fails when verified_at is in the future (bogus, not fresh)', () => {
    const future = new Date(now.getTime() + 60_000);
    expect(isVerifiedFresh(future.toISOString(), now)).toBe(false);
  });

  it('respects a custom window', () => {
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    expect(isVerifiedFresh(fiveDaysAgo.toISOString(), now, 3)).toBe(false);
    expect(isVerifiedFresh(fiveDaysAgo.toISOString(), now, 7)).toBe(true);
  });

  it('the default window is the named constant (14 days)', () => {
    expect(VERIFICATION_FRESHNESS_DAYS).toBe(14);
  });
});
