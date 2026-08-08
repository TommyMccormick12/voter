// A track_record_note must say something about a specific vote or
// statement. The system prompt forbids notes that merely announce an
// absence and tells Haiku to omit the field — and Haiku ignores that for
// challengers. The Speir run came back with "No voting record available as
// candidate has not held office." on all five stances.
//
// That matters beyond tidiness: it lands on every challenger, because no
// challenger has a voting record, and challengers are the whole coverage
// backlog. So the strip happens server-side.
//
// The risk to guard is over-stripping. A note that reports a real vote and
// ALSO mentions a gap is substantive and must survive intact.

import { describe, it, expect } from 'vitest';
import { isAbsenceOnlyNote } from '@/lib/llm/curate';

describe('isAbsenceOnlyNote', () => {
  it('strips the exact note the Speir run produced', () => {
    expect(
      isAbsenceOnlyNote('No voting record available as candidate has not held office.'),
    ).toBe(true);
  });

  it.each([
    'No relevant voting record.',
    'No contradictions found.',
    'Insufficient data to verify.',
    'Candidate has not held public office.',
    'Unable to verify.',
    'No public statements on record.',
  ])('strips the forbidden meta-comment %j', (note) => {
    expect(isAbsenceOnlyNote(note)).toBe(true);
  });

  it('keeps a note that cites a real roll call', () => {
    expect(
      isAbsenceOnlyNote('Voted nay on house-119-2-277, the motion to recommit.'),
    ).toBe(false);
  });

  it('keeps a substantive note even when it also mentions a gap', () => {
    // The whole point of the sentence-wise rule: one real claim saves it.
    expect(
      isAbsenceOnlyNote(
        'Voted yea on hr8800-119 passage. No voting record exists for the earlier session.',
      ),
    ).toBe(false);
  });

  it('keeps an ordinary substantive note', () => {
    expect(
      isAbsenceOnlyNote('Stated position conflicts with his campaign-site plank on spending.'),
    ).toBe(false);
  });

  it('treats empty, blank, null, and undefined as nothing to strip', () => {
    expect(isAbsenceOnlyNote('')).toBe(false);
    expect(isAbsenceOnlyNote('   ')).toBe(false);
    expect(isAbsenceOnlyNote(null)).toBe(false);
    expect(isAbsenceOnlyNote(undefined)).toBe(false);
  });

  it('strips a multi-sentence note only when EVERY sentence is an absence claim', () => {
    expect(
      isAbsenceOnlyNote('No voting record available. Insufficient data to verify.'),
    ).toBe(true);
    expect(
      isAbsenceOnlyNote('No voting record available. He founded a school in Bradenton.'),
    ).toBe(false);
  });
});
