// Nothing on this site knew what day it was. Every date-bearing surface was
// built for the run-up to a primary — "Primary · August 18, 2026", a
// countdown, a standing invitation to find your best match — and none of it
// changed on its own. On the morning of August 19 the site would still have
// asked a voter to rank candidates in a contest that was over.
//
// That is the same class of false claim as rendering a coverage count as a
// ballot size, which is already guarded in coverage.ts.
//
// The rules worth pinning:
//   - Election day itself is LIVE. People vote all day; a page going cold at
//     midnight would be wrong for the hours that matter most.
//   - An unknown date is never "concluded". Unknown is not past, and the
//     failure mode of guessing wrong is hiding a live race.

import { describe, it, expect } from 'vitest';
import { electionHasConcluded, concludedNotice } from '@/lib/election-status';

const ELECTION = '2026-08-18';
const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe('electionHasConcluded', () => {
  it.each([
    ['ten days before', local(2026, 8, 8)],
    ['the day before', local(2026, 8, 17, 23)],
    ['the morning of election day', local(2026, 8, 18, 7)],
    ['while polls are still open', local(2026, 8, 18, 19)],
    ['one minute before midnight on election day', local(2026, 8, 18, 23)],
  ])('treats %s as still live', (_label, now) => {
    expect(electionHasConcluded(ELECTION, now)).toBe(false);
  });

  it.each([
    ['the morning after', local(2026, 8, 19, 6)],
    ['a week later', local(2026, 8, 25)],
    ['months later', local(2026, 12, 1)],
  ])('treats %s as concluded', (_label, now) => {
    expect(electionHasConcluded(ELECTION, now)).toBe(true);
  });

  it('flips exactly at the end of election day, not at its start', () => {
    // The boundary is the whole point: voting happens on the date itself.
    expect(electionHasConcluded(ELECTION, new Date(2026, 7, 18, 23, 59, 59))).toBe(false);
    expect(electionHasConcluded(ELECTION, new Date(2026, 7, 19, 0, 0, 1))).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['not a date', 'sometime in August'],
  ])('never concludes a race whose date is %s', (_label, value) => {
    // Unknown is not past. Guessing wrong here hides a live race.
    expect(electionHasConcluded(value, local(2030, 1, 1))).toBe(false);
  });

  it('handles a full ISO timestamp, not just YYYY-MM-DD', () => {
    expect(electionHasConcluded('2026-08-18T00:00:00Z', local(2026, 8, 25))).toBe(true);
  });

  it('reads the date as local, so it cannot be off by one west of UTC', () => {
    // parseLocalDate exists because new Date('2026-08-18') is UTC midnight,
    // which renders as the 17th in every US timezone. A civic tool cannot be
    // a day wrong about when an election is.
    expect(electionHasConcluded(ELECTION, local(2026, 8, 18, 20))).toBe(false);
  });
});

describe('concludedNotice', () => {
  const notice = concludedNotice('August 18, 2026');

  it('names the date the vote was held', () => {
    expect(notice).toContain('August 18, 2026');
  });

  it('says scorecards remain as a record rather than implying the page is current', () => {
    expect(notice).toMatch(/record/i);
  });

  it('states plainly that no results are reported', () => {
    // There is no results source in this codebase. Implying an outcome would
    // be a far worse failure than a stale date.
    expect(notice).toMatch(/do not report results/i);
  });

  it.each(['won', 'winner', 'advances', 'defeated', 'elected'])(
    'never uses outcome language like "%s"',
    (word) => {
      expect(notice.toLowerCase()).not.toContain(word);
    },
  );
});
