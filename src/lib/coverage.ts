/**
 * Copy for "how many candidates are we showing you, out of how many are
 * actually on your ballot".
 *
 * Both the race picker and the scorecard header used to render the profiled
 * count as a bare "N candidates", which stated a ballot size that was often
 * wrong — the picker claimed 3 for a FL-16 D race that lists 5, and 1 for a
 * FL-14 R race that lists 8. #28 relabelled those "with policy data", which
 * is true but leaves the voter with no idea what they are missing.
 *
 * Migration 017 supplies the real denominator, so the honest version can be
 * exact. This module is the single source of that copy, so the two surfaces
 * cannot drift apart.
 */

/**
 * Is the ballot total trustworthy enough to state as fact?
 *
 * Null means unknown, never zero — that is the whole point of making
 * `races.ballot_candidate_count` nullable in migration 017. A total smaller
 * than the number of candidates already on screen is nonsense, so it is
 * treated the same as unknown.
 */
function ballotTotalIsUsable(profiled: number, ballotTotal: number | null): ballotTotal is number {
  return (
    typeof ballotTotal === 'number' &&
    Number.isFinite(ballotTotal) &&
    ballotTotal > 0 &&
    ballotTotal >= profiled
  );
}

/** True only when every candidate on the ballot is profiled AND we know the ballot size. */
export function isFullyCovered(profiled: number, ballotTotal: number | null): boolean {
  return ballotTotalIsUsable(profiled, ballotTotal) && ballotTotal === profiled;
}

/**
 * Should the scorecard offer the match flow?
 *
 * The 3+ threshold exists to stop the feature appearing on races we have
 * barely covered, where ranking 1 of 8 candidates tells a voter nothing. It
 * does not fit a race where coverage is complete: 10 contested races hold
 * exactly two candidates and profile both, so they can never reach 3 and the
 * feature stays dark forever — including the U.S. Senate Democratic primary,
 * the highest-profile race on the site.
 *
 * So: 3+ profiled, or a two-candidate ballot we cover completely.
 *
 * A partially covered race is deliberately unchanged. 2 profiled of 5 keeps
 * the soft copy, because the missing three are exactly why ranking the two
 * would mislead. An unknown ballot size is partial coverage, never full —
 * guessing there would put the CTA on a race we cannot vouch for.
 *
 * This gate is presentational. The match API rejects only a race with zero
 * candidates, so it has never enforced 3+; a direct link already worked.
 * This makes the CTA agree with what the product actually supports.
 */
export function matchIsOpen(profiled: number, ballotTotal: number | null): boolean {
  if (profiled >= 3) return true;
  return profiled === 2 && isFullyCovered(profiled, ballotTotal);
}

export interface CoverageCopy {
  /** Compact label for a card or a header meta line. */
  label: string;
  /** True when the ballot holds candidates we are not showing. */
  hasUncovered: boolean;
}

/**
 * @param profiled Candidates we are actually rendering.
 * @param ballotTotal Qualified candidates on the ballot, or null if unknown.
 *
 * Falls back to the vaguer "with policy data" wording whenever the total is
 * unknown or fails a sanity check, because a denominator that is null, zero,
 * or somehow smaller than the number of candidates already on screen cannot
 * be stated as fact. Guessing there would recreate the original bug in a new
 * form.
 */
export function coverageCopy(profiled: number, ballotTotal: number | null): CoverageCopy {
  if (!ballotTotalIsUsable(profiled, ballotTotal)) {
    return {
      label: `${profiled} with policy data`,
      // Unknown is not the same as none. Keep the soft disclosure showing so
      // a voter is never told a partial field is the whole field.
      hasUncovered: true,
    };
  }

  const total = ballotTotal;
  if (total === profiled) {
    // Full coverage. Saying "3 of 3" invites the reader to hunt for a
    // missing fourth, so state it plainly instead.
    return {
      label: profiled === 1 ? '1 candidate' : `all ${profiled} candidates`,
      hasUncovered: false,
    };
  }

  return { label: `${profiled} of ${total} candidates`, hasUncovered: true };
}
