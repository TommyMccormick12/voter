// `synth:stances --only-slug` compared the flag against `ballotpedia_slug`, a
// field no candidate in these fixtures carries. The flag therefore matched
// nobody, the loop skipped every candidate, and the run printed a successful
// summary having done nothing.
//
// The practical damage was not the wasted run. It was that every synthesis had
// to go race-wide, regenerating stances for candidates who were already live,
// with a human diff as the only thing standing between a discovery run and a
// live scorecard changing underneath a voter.
//
// These tests pin both halves of the fix: the flag matches the real slug, and
// a slug matching nobody is an error rather than a quiet success.

import { describe, it, expect } from 'vitest';
import {
  selectForSynthesis,
  effectiveSlug,
  slugify,
} from '../scripts/synthesize/candidate-selection';

const RACE = [
  { name: 'Alan Grayson', slug: 'alan-grayson' },
  { name: 'Jennifer Jenkins', slug: 'jennifer-jenkins', top_stances: [{ issue_slug: 'economy' }] },
  { name: 'Eddie Speir', slug: 'jason-edward-speir', top_stances: [{ issue_slug: 'housing' }] },
];

describe('effectiveSlug', () => {
  it('uses the explicit slug, which comes from the FEC legal name', () => {
    // Eddie Speir is stored as jason-edward-speir. Deriving from the display
    // name would target a candidate that does not exist in the fixture.
    expect(effectiveSlug({ name: 'Eddie Speir', slug: 'jason-edward-speir' })).toBe(
      'jason-edward-speir',
    );
  });

  it('derives from the name when the fixture carries no slug', () => {
    // Matches what synthesize_stances.ts writes back, so selection and the
    // fixture agree on what a candidate is called.
    expect(effectiveSlug({ name: "Robert M. O'Neeld" })).toBe('robert-m-oneeld');
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
  ])('treats a %s slug as absent and falls back to the name', (_label, slug) => {
    expect(effectiveSlug({ name: 'Mark Piper', slug })).toBe('mark-piper');
  });

  it('trims a padded slug rather than matching on the padding', () => {
    expect(effectiveSlug({ name: 'Mark Piper', slug: '  mark-piper  ' })).toBe('mark-piper');
  });
});

describe('slugify', () => {
  it.each([
    ['Alan Grayson', 'alan-grayson'],
    ["Robert M. Neeld", 'robert-m-neeld'],
    ["Shevrin D. Jones", 'shevrin-d-jones'],
  ])('turns %s into %s', (name, expected) => {
    expect(slugify(name)).toBe(expected);
  });
});

describe('selectForSynthesis', () => {
  it('selects exactly the candidate named by --only-slug', () => {
    // The regression itself: this selected nobody before the fix.
    const { selected } = selectForSynthesis(RACE, 'alan-grayson');
    expect(selected).toHaveLength(1);
    expect(selected[0].name).toBe('Alan Grayson');
  });

  it('matches an FEC-legal-name slug, not the display name', () => {
    const { selected } = selectForSynthesis(RACE, 'jason-edward-speir');
    expect(selected.map((c) => c.name)).toEqual(['Eddie Speir']);
  });

  it('matches a candidate whose fixture carries no slug field', () => {
    const race = [{ name: 'Alan Grayson' }, { name: 'Mark Piper' }];
    expect(selectForSynthesis(race, 'mark-piper').selected).toEqual([{ name: 'Mark Piper' }]);
  });

  it('leaves every other candidate out of the run', () => {
    const { skipped } = selectForSynthesis(RACE, 'alan-grayson');
    expect(skipped.map((c) => c.name)).toEqual(['Jennifer Jenkins', 'Eddie Speir']);
  });

  it('returns skipped candidates untouched, stances included', () => {
    // The point of the flag: a discovery run must not regenerate stances for
    // a candidate who is already live.
    const before = JSON.parse(JSON.stringify(RACE.slice(1)));
    const { skipped } = selectForSynthesis(RACE, 'alan-grayson');
    expect(skipped).toEqual(before);
  });

  it('tolerates a padded --only-slug value from a shell argument', () => {
    expect(selectForSynthesis(RACE, '  alan-grayson  ').selected[0].name).toBe('Alan Grayson');
  });

  it.each([
    ['no flag', undefined],
    ['an empty flag', ''],
    ['a whitespace-only flag', '  '],
  ])('runs race-wide with %s', (_label, onlySlug) => {
    const { selected, skipped } = selectForSynthesis(RACE, onlySlug);
    expect(selected).toHaveLength(RACE.length);
    expect(skipped).toEqual([]);
  });

  it('does not hand back the caller’s own array when running race-wide', () => {
    const { selected } = selectForSynthesis(RACE);
    expect(selected).not.toBe(RACE);
    expect(selected).toEqual(RACE);
  });

  it('throws when the slug matches nobody, rather than reporting a run that did nothing', () => {
    expect(() => selectForSynthesis(RACE, 'alan-greyson')).toThrow(/matches no candidate/);
  });

  it('names the slugs the fixture does carry, so a typo is fixable from the error', () => {
    expect(() => selectForSynthesis(RACE, 'alan-greyson')).toThrow(
      /alan-grayson, jennifer-jenkins, jason-edward-speir/,
    );
  });

  it('rejects the old ballotpedia_slug value, which is what the flag used to match', () => {
    const race = [{ name: 'Alan Grayson', slug: 'alan-grayson', ballotpedia_slug: 'Alan_Grayson' }];
    expect(() => selectForSynthesis(race, 'Alan_Grayson')).toThrow(/matches no candidate/);
  });

  it('reports an empty race honestly instead of naming no slugs at all', () => {
    expect(() => selectForSynthesis([], 'alan-grayson')).toThrow(/holds no named candidates/);
  });
});
