// Regression tests for normalizeCoverageEndDate (src/lib/api-clients/fec.ts).
//
// Origin: on 2026-08-07 the totals endpoint advertised Dan Bilzerian's
// (H6FL06415) genuine $1,241,449.83 as covered "through 2026-09-30" — a date
// that had not happened yet. The endpoint reports the MAX coverage_end_date
// across a candidate's filings, and his committee had filed an empty October
// Quarterly (receipts 0, period 2026-07-01 -> 2026-09-30) beside two real
// reports. Rendering that beside a dollar figure would tell a voter the money
// is fresher than any filed report supports, which is exactly what
// fec_coverage_end_date exists to prevent.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeCoverageEndDate } from '@/lib/api-clients/fec';

const NOW = new Date('2026-08-07T12:00:00Z');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normalizeCoverageEndDate', () => {
  it('keeps a past coverage date, trimmed to a calendar date', () => {
    expect(normalizeCoverageEndDate('2026-07-29T00:00:00+00:00', NOW)).toBe('2026-07-29');
  });

  it('keeps today', () => {
    expect(normalizeCoverageEndDate('2026-08-07T00:00:00', NOW)).toBe('2026-08-07');
  });

  it('drops a future coverage date rather than showing an unearned freshness claim', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The exact Bilzerian case.
    expect(normalizeCoverageEndDate('2026-09-30T00:00:00', NOW)).toBeNull();
  });

  it('warns loudly when it drops one, so a bulk run is not silently lossy', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    normalizeCoverageEndDate('2026-09-30T00:00:00', NOW);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/2026-09-30/);
  });

  it('returns null for missing or malformed values instead of guessing', () => {
    expect(normalizeCoverageEndDate(null, NOW)).toBeNull();
    expect(normalizeCoverageEndDate(undefined, NOW)).toBeNull();
    expect(normalizeCoverageEndDate('', NOW)).toBeNull();
    expect(normalizeCoverageEndDate('not-a-date', NOW)).toBeNull();
    expect(normalizeCoverageEndDate(20260729, NOW)).toBeNull();
  });

  it('does not treat a date one day ahead as acceptable', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeCoverageEndDate('2026-08-08T00:00:00', NOW)).toBeNull();
  });
});
