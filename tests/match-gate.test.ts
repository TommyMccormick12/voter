// When does the scorecard offer the match flow?
//
// The 3+ threshold exists to stop the CTA appearing on races we have barely
// covered, where ranking 1 of 8 candidates tells a voter nothing. It never
// fit a race we cover completely: 10 contested races hold exactly two
// candidates and profile both, so they can never reach 3 and the feature
// stayed dark forever — the U.S. Senate Democratic primary among them.
//
// The rules worth pinning:
//   - 3+ profiled always opens, exactly as before.
//   - A two-candidate ballot fully covered opens too.
//   - Partial coverage never opens, however many are profiled below 3 — the
//     candidates missing from the page are the reason a ranking would
//     mislead, and that reason does not weaken.
//   - An unknown ballot size is partial, never full. Guessing there would put
//     the CTA on a race we cannot vouch for.

import { describe, it, expect } from 'vitest';
import { matchIsOpen, isFullyCovered } from '@/lib/coverage';

describe('matchIsOpen', () => {
  it('opens a fully covered two-candidate ballot', () => {
    // FL-Sen D — fully covered, highest-profile race on the site, and dark
    // before this rule existed.
    expect(matchIsOpen(2, 2)).toBe(true);
  });

  it.each([
    ['3 of 3', 3, 3],
    ['3 of 10', 3, 10],
    ['8 of 8', 8, 8],
  ])('leaves the existing 3+ behaviour alone: %s', (_label, profiled, total) => {
    expect(matchIsOpen(profiled, total)).toBe(true);
  });

  it('opens at 3+ even when the ballot size is unknown, as it always did', () => {
    expect(matchIsOpen(3, null)).toBe(true);
  });

  it.each([
    ['2 of 5', 2, 5],
    ['2 of 3', 2, 3],
    ['2 of 8', 2, 8],
  ])('stays shut on a partially covered race: %s', (_label, profiled, total) => {
    expect(matchIsOpen(profiled, total)).toBe(false);
  });

  it('treats an unknown ballot size as partial, never as fully covered', () => {
    // The guard that matters most: null means unknown, never 2.
    expect(matchIsOpen(2, null)).toBe(false);
  });

  it.each([
    ['a zero total', 2, 0],
    ['a total smaller than the profiled count', 2, 1],
    ['a non-finite total', 2, Number.NaN],
  ])('refuses to read %s as full coverage', (_label, profiled, total) => {
    expect(matchIsOpen(profiled, total)).toBe(false);
  });

  it.each([
    ['a lone candidate on a two-person ballot', 1, 2],
    ['a no_primary race, where one candidate is the whole ballot', 1, 1],
    ['an empty race', 0, 0],
  ])('stays shut for %s', (_label, profiled, total) => {
    // A one-candidate ballot is fully covered and still has nothing to rank.
    expect(matchIsOpen(profiled, total)).toBe(false);
  });
});

describe('isFullyCovered', () => {
  it.each([
    ['2 of 2', 2, 2, true],
    ['3 of 3', 3, 3, true],
    ['1 of 1, a no_primary race', 1, 1, true],
    ['3 of 10', 3, 10, false],
    ['2 with an unknown ballot', 2, null, false],
    ['2 against a zero ballot', 2, 0, false],
  ])('%s', (_label, profiled, total, expected) => {
    expect(isFullyCovered(profiled, total)).toBe(expected);
  });
});
