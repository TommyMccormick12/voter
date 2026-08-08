// coverageCopy decides what a voter is told about how much of their ballot
// this page shows. The failure mode it exists to prevent is stating a number
// as the ballot when it only counts coverage — the picker once claimed
// "3 candidates" for a FL-16 D race listing 5, and "1 candidate" for a
// FL-14 R race listing 8.
//
// The rules worth pinning:
//   - An exact "N of M" only when M is trustworthy.
//   - A null/zero/nonsense M falls back to vaguer copy AND keeps the
//     disclosure on, because unknown is not the same as none.
//   - Full coverage says so plainly rather than "3 of 3", which reads as an
//     invitation to hunt for a missing fourth.

import { describe, it, expect } from 'vitest';
import { coverageCopy } from '@/lib/coverage';

describe('coverageCopy', () => {
  it('states the exact fraction when the ballot total is known', () => {
    expect(coverageCopy(3, 10)).toEqual({
      label: '3 of 10 candidates',
      hasUncovered: true,
    });
  });

  it('covers the worst real case, 1 profiled of an 8-person ballot', () => {
    expect(coverageCopy(1, 8).label).toBe('1 of 8 candidates');
    expect(coverageCopy(1, 8).hasUncovered).toBe(true);
  });

  it('says so plainly at full coverage instead of "3 of 3"', () => {
    expect(coverageCopy(3, 3)).toEqual({
      label: 'all 3 candidates',
      hasUncovered: false,
    });
  });

  it('uses the singular at full coverage of a one-candidate ballot', () => {
    expect(coverageCopy(1, 1)).toEqual({ label: '1 candidate', hasUncovered: false });
  });

  it('falls back to vaguer copy when the total is unknown', () => {
    expect(coverageCopy(2, null)).toEqual({
      label: '2 with policy data',
      // Unknown is not none — the disclosure must stay on.
      hasUncovered: true,
    });
  });

  it.each([
    ['zero', 0],
    ['negative', -4],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('falls back rather than trusting a %s total', (_label, total) => {
    const result = coverageCopy(2, total as number);
    expect(result.label).toBe('2 with policy data');
    expect(result.hasUncovered).toBe(true);
  });

  it('falls back when the total is smaller than what we are showing', () => {
    // A stale or wrong denominator must never produce "5 of 3".
    const result = coverageCopy(5, 3);
    expect(result.label).toBe('5 with policy data');
    expect(result.hasUncovered).toBe(true);
  });

  it('never renders a bare count that could be read as the ballot size', () => {
    for (const [profiled, total] of [
      [1, 8],
      [3, 10],
      [2, null],
      [5, 3],
    ] as Array<[number, number | null]>) {
      const { label } = coverageCopy(profiled, total);
      expect(label).not.toMatch(/^\d+ candidates?$/);
    }
  });
});
