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
  const totalIsUsable =
    typeof ballotTotal === 'number' &&
    Number.isFinite(ballotTotal) &&
    ballotTotal > 0 &&
    ballotTotal >= profiled;

  if (!totalIsUsable) {
    return {
      label: `${profiled} with policy data`,
      // Unknown is not the same as none. Keep the soft disclosure showing so
      // a voter is never told a partial field is the whole field.
      hasUncovered: true,
    };
  }

  const total = ballotTotal as number;
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
