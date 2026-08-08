// Regression tests for isProceduralVote (src/lib/llm/curate.ts).
//
// Origin: on 2026-08-07 three independent verifiers caught stances built on
// motion-to-recommit votes, and the error ran BOTH ways —
//   Aaron Bean's NAY on an MTR was written as "voted against the Take Care of
//   America's Veterans Act" (a nay actually lets the bill proceed), while
//   Kathy Castor's YEA on the SAME motion was written as supporting a veterans
//   bill (a yea sends it back to committee).
// Migration 016 preserves the question in `vote_question` while bill_title
// stores the bill name. These tests pin the detection so the warning cannot
// silently stop firing.

import { describe, it, expect } from 'vitest';
import { isProceduralVote } from '@/lib/llm/curate';

describe('isProceduralVote', () => {
  it('flags the motion-to-recommit question that caused the real inversions', () => {
    expect(isProceduralVote('On Motion to Recommit')).toBe(true);
    expect(isProceduralVote('On Motion to Recommit with Instructions')).toBe(true);
  });

  it('flags the other common procedural questions', () => {
    expect(isProceduralVote('On Motion to Table')).toBe(true);
    expect(isProceduralVote('On Ordering the Previous Question')).toBe(true);
    expect(isProceduralVote('On Motion to Adjourn')).toBe(true);
  });

  it('is case-insensitive, since the wire capitalization is not guaranteed', () => {
    expect(isProceduralVote('on motion to recommit')).toBe(true);
    expect(isProceduralVote('ON MOTION TO TABLE')).toBe(true);
  });

  it('does NOT flag substantive passage votes', () => {
    expect(isProceduralVote('On Passage')).toBe(false);
    expect(isProceduralVote('On Motion to Suspend the Rules and Pass')).toBe(false);
    expect(isProceduralVote('On Motion to Suspend the Rules and Pass, as Amended')).toBe(false);
    expect(isProceduralVote('On Agreeing to the Resolution')).toBe(false);
    expect(isProceduralVote('On Concurring in Senate Amendment')).toBe(false);
  });

  it('treats a suspension vote as substantive even though it says "Motion"', () => {
    // This is the discrimination that matters: "Motion to Suspend the Rules
    // and Pass" IS the passage vote and reads in the same direction as the
    // bill, unlike "Motion to Recommit".
    expect(isProceduralVote('On Motion to Suspend the Rules and Pass')).toBe(false);
  });

  it('handles missing values without throwing', () => {
    expect(isProceduralVote(null)).toBe(false);
    expect(isProceduralVote(undefined)).toBe(false);
    expect(isProceduralVote('')).toBe(false);
  });
});
