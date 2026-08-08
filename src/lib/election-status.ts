/**
 * Has the election a page is describing already happened?
 *
 * Every date-bearing surface on this site was built for the run-up to a
 * primary and says so: "Primary · August 18, 2026", a countdown, and a
 * standing invitation to find your best match. None of it changes on its
 * own. On the morning of August 19 the site would still ask a voter to rank
 * candidates in a contest that is over, which is the same class of false
 * claim as rendering a coverage count as a ballot size.
 *
 * What this module deliberately does NOT do is state an outcome. There is no
 * results source in this codebase, and inventing one — or implying a winner
 * from the data we happen to hold — would be a far worse failure than a
 * stale date. A concluded race keeps its scorecards as a record of who was
 * on the ballot and what they said, and says plainly that the vote has
 * happened.
 *
 * Election day itself counts as live. People vote all day on the 18th, and a
 * page that goes cold at midnight would be wrong for the sixteen hours that
 * matter most.
 */

import { parseLocalDate } from './dates';

/**
 * True once the election date has fully passed in the viewer's local
 * timezone — that is, from the day AFTER the election onward.
 *
 * Florida votes on Eastern time and the site renders in the viewer's zone,
 * so a voter west of Eastern sees the race stay live slightly longer than
 * the polls do. That direction is the safe one: it briefly over-states how
 * live a race is rather than telling someone the election is over while
 * they can still reach a polling place.
 *
 * An unparseable or missing date is never treated as concluded. Unknown is
 * not the same as past, and the failure mode of guessing wrong here is
 * hiding a live race.
 */
export function electionHasConcluded(
  electionDate: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const d = parseLocalDate(electionDate);
  if (!d) return false;

  const endOfElectionDay = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    23,
    59,
    59,
    999,
  );
  return now.getTime() > endOfElectionDay.getTime();
}

/**
 * The line shown on a concluded race, naming the date the vote was held.
 *
 * Phrased as a statement of record rather than a result. "This primary was
 * held on ..." is true whatever the outcome; anything about who advanced
 * would be a claim this codebase cannot source.
 */
export function concludedNotice(dateLabel: string): string {
  return `This primary was held on ${dateLabel}. Scorecards stay up as a record of who was on the ballot and what they said. We do not report results.`;
}
