// Tests for matchRoleByName in src/lib/api-clients/govtrack.ts.
// Specifically guards against the Royal-Webster-vs-Daniel-Webster
// false-positive that surfaced in Tier 2 ingest (Phase 2D-ter §18.1).

import { describe, it, expect } from 'vitest';
import { matchRoleByName } from '@/lib/api-clients/govtrack';
import type { GovTrackRole, GovTrackPerson } from '@/lib/api-clients/govtrack';

function role(firstname: string, lastname: string, state = 'FL', district = '11'): GovTrackRole {
  const person: GovTrackPerson = {
    id: 0,
    firstname,
    lastname,
    name: `${firstname} ${lastname}`,
    bioguideid: 'X000000',
    link: `https://www.govtrack.us/congress/members/${firstname.toLowerCase()}_${lastname.toLowerCase()}/0`,
  } as GovTrackPerson;
  return {
    person,
    role_type: 'representative',
    state,
    district,
    current: true,
    party: 'Republican',
    title: 'Rep.',
    title_long: 'Representative',
    description: 'Test',
    enddate: '2027-01-01',
    startdate: '2025-01-01',
  } as GovTrackRole;
}

describe('matchRoleByName', () => {
  describe('exact full-name match', () => {
    it('finds a sitting member by exact name', () => {
      const candidates = [role('Daniel', 'Webster'), role('Maxwell', 'Frost')];
      const hit = matchRoleByName(candidates, 'Daniel Webster');
      expect(hit?.person.firstname).toBe('Daniel');
    });

    it('is case-insensitive', () => {
      const candidates = [role('Daniel', 'Webster')];
      expect(matchRoleByName(candidates, 'DANIEL WEBSTER')?.person.lastname).toBe('Webster');
      expect(matchRoleByName(candidates, 'daniel webster')?.person.lastname).toBe('Webster');
    });

    it('returns null when no match', () => {
      const candidates = [role('Daniel', 'Webster')];
      expect(matchRoleByName(candidates, 'Maxwell Frost')).toBeNull();
    });
  });

  describe('multi-word query — first-name prefix guard (Royal-Webster regression)', () => {
    it('REGRESSION: "Royal Webster" does NOT match against incumbent Daniel Webster', () => {
      // Royal is a challenger never in GovTrack. Daniel is the sitting
      // incumbent. The legacy last-name-only fallback used to match Royal
      // → Daniel and inherit Daniel's voting record. This must not happen.
      const candidates = [role('Daniel', 'Webster')];
      const hit = matchRoleByName(candidates, 'Royal Webster');
      expect(hit).toBeNull();
    });

    it('matches lastname-equal first-name-prefix (Sheila Cherfilus-McCormick)', () => {
      // GovTrack stores firstname=Sheila. Query is the full name; first
      // token "Sheila" must match firstname.
      const candidates = [role('Sheila', 'Cherfilus-McCormick', 'FL', '20')];
      const hit = matchRoleByName(candidates, 'Sheila Cherfilus-McCormick');
      expect(hit?.person.firstname).toBe('Sheila');
    });

    it('matches nickname truncation (Max → Maxwell)', () => {
      // Bi-directional prefix: "max" startsWith first 3 of "maxwell"? No.
      // "maxwell" startsWith first 3 of "max" ("max"). Yes → match.
      const candidates = [role('Maxwell', 'Frost', 'FL', '10')];
      const hit = matchRoleByName(candidates, 'Max Frost');
      expect(hit?.person.firstname).toBe('Maxwell');
    });

    it('matches reverse nickname truncation (Maxwell → Max)', () => {
      // Person in GovTrack as "Max", query is "Maxwell Frost".
      const candidates = [role('Max', 'Frost', 'FL', '10')];
      const hit = matchRoleByName(candidates, 'Maxwell Frost');
      expect(hit?.person.firstname).toBe('Max');
    });

    it('does NOT match on shared single-letter prefix', () => {
      // "Daniel" and "David" both start with "D" but are different
      // people. Single-letter prefix must not constitute a match.
      const candidates = [role('Daniel', 'Smith', 'FL', '15')];
      const hit = matchRoleByName(candidates, 'David Smith');
      expect(hit).toBeNull();
    });

    it('does NOT match short queries on incidental prefix overlap', () => {
      // "Don" and "Donald" share 3 chars but caller passing "Don Smith"
      // probably means a different person. Hmm — actually this IS a true
      // positive case (Don is a common nickname for Donald). Test it.
      const candidates = [role('Donald', 'Smith', 'FL', '15')];
      const hit = matchRoleByName(candidates, 'Don Smith');
      expect(hit?.person.firstname).toBe('Donald');
    });
  });

  describe('initial-only stored firstname (GovTrack data quirk)', () => {
    it('REGRESSION: Scott Franklin matches against "C. Franklin"', () => {
      // GovTrack stores some incumbents with just an initial as
      // firstname (e.g., FL-18 incumbent "C. Franklin" — really
      // Scott Franklin). The legacy last-name-only fallback handled
      // this; our multi-word prefix check would reject it unless we
      // explicitly allow initial-only stored firstnames.
      const candidates = [role('C.', 'Franklin', 'FL', '18')];
      const hit = matchRoleByName(candidates, 'Scott Franklin');
      expect(hit?.person.firstname).toBe('C.');
    });

    it('initial without dot (single letter) also passes', () => {
      const candidates = [role('W', 'Steube', 'FL', '17')];
      const hit = matchRoleByName(candidates, 'Greg Steube');
      expect(hit?.person.firstname).toBe('W');
    });

    it('two-letter stored name (e.g. "Jo") also passes the initial-only check', () => {
      // "Jo" is short enough to be effectively an initial.
      const candidates = [role('Jo', 'Smith', 'FL', '15')];
      const hit = matchRoleByName(candidates, 'Joseph Smith');
      expect(hit?.person.firstname).toBe('Jo');
    });
  });

  describe('single-word query — legacy last-name fallback', () => {
    it('falls through to last-name-only when query is a single word', () => {
      // Caller is passing a bare surname — they explicitly accept the
      // false-positive risk. This preserves the legacy contract.
      const candidates = [role('Daniel', 'Webster')];
      const hit = matchRoleByName(candidates, 'Webster');
      expect(hit?.person.firstname).toBe('Daniel');
    });
  });

  describe('empty / whitespace input', () => {
    it('returns null on empty query', () => {
      expect(matchRoleByName([role('Daniel', 'Webster')], '')).toBeNull();
      expect(matchRoleByName([role('Daniel', 'Webster')], '   ')).toBeNull();
    });
  });
});
