// `/candidate/{id}/totals` reports the MAX coverage_end_date across a
// candidate's filings, including reporting periods that have not closed.
// normalizeCoverageEndDate drops such a future date, which is right — but on
// its own it also erases a date an earlier pull had already established.
//
// Dan Bilzerian is the worked example. His committee filed an empty October
// Quarterly (receipts 0, coverage through 2026-09-30) beside two real
// reports. An earlier pull recorded his genuine $1,241,449.83 as through
// 2026-07-29. The 2026-08-08 re-pull saw only the future 2026-09-30, dropped
// it, and would have written null — leaving DonorProfile rendering a dollar
// figure with no date beside it.
//
// The retention is narrow on purpose: receipts must be identical. Different
// receipts mean activity landed after that period closed, so pairing a new
// total with the old date would understate how fresh the money is. That is a
// quieter lie than showing no date, so it is not allowed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { retainedCoverageEndDate } from '../scripts/ingest/fetch_fec';

const TODAY = new Date('2026-08-08T12:00:00Z');
const RECEIPTS = 1241449.83;

describe('retainedCoverageEndDate', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the fetched date whenever the endpoint reports a usable one', () => {
    expect(
      retainedCoverageEndDate('2026-07-29', '2026-06-30', RECEIPTS, RECEIPTS, 'x', TODAY),
    ).toBe('2026-07-29');
  });

  it('prefers the fetched date even when it moves BACKWARDS from the stored one', () => {
    // The endpoint is the authority when it speaks. Only silence triggers retention.
    expect(
      retainedCoverageEndDate('2026-06-30', '2026-07-29', RECEIPTS, RECEIPTS, 'x', TODAY),
    ).toBe('2026-06-30');
  });

  it('keeps the known last closed period when the endpoint goes quiet and receipts are unchanged', () => {
    // The regression itself — this returned null before the fix.
    expect(
      retainedCoverageEndDate(null, '2026-07-29', RECEIPTS, RECEIPTS, 'Dan Bilzerian', TODAY),
    ).toBe('2026-07-29');
  });

  it('says why it retained, so a re-pull diff is explainable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    retainedCoverageEndDate(null, '2026-07-29', RECEIPTS, RECEIPTS, 'Dan Bilzerian', TODAY);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Dan Bilzerian'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2026-07-29'));
  });

  it.each([
    ['receipts rose', RECEIPTS + 5000],
    ['receipts fell', RECEIPTS - 5000],
    ['receipts moved by a cent', RECEIPTS + 0.01],
  ])('drops the date when %s, rather than dating new money to an old period', (_label, fetched) => {
    expect(retainedCoverageEndDate(null, '2026-07-29', fetched, RECEIPTS, 'x', TODAY)).toBeNull();
  });

  it('drops the date when the fixture held no receipts to compare against', () => {
    expect(
      retainedCoverageEndDate(null, '2026-07-29', RECEIPTS, undefined, 'x', TODAY),
    ).toBeNull();
  });

  it('never retains a stored date that is itself in the future', () => {
    // Same check that rejected the incoming date. A future date is not a
    // closed period no matter which side of the pull it came from.
    expect(
      retainedCoverageEndDate(null, '2026-09-30', RECEIPTS, RECEIPTS, 'x', TODAY),
    ).toBeNull();
  });

  it('retains a stored date equal to today, which is a closed period', () => {
    expect(
      retainedCoverageEndDate(null, '2026-08-08', RECEIPTS, RECEIPTS, 'x', TODAY),
    ).toBe('2026-08-08');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['a timestamp rather than a calendar date', '2026-07-29T00:00:00Z'],
    ['a malformed date', '07/29/2026'],
  ])('returns null when the stored date is %s', (_label, existing) => {
    expect(
      retainedCoverageEndDate(null, existing as string | null, RECEIPTS, RECEIPTS, 'x', TODAY),
    ).toBeNull();
  });

  it('returns null when neither side has a date, the genuine unknown', () => {
    expect(retainedCoverageEndDate(null, null, RECEIPTS, RECEIPTS, 'x', TODAY)).toBeNull();
  });
});
