// Date utilities — handle ISO date strings (YYYY-MM-DD) as local dates,
// not UTC. Critical for election dates, vote dates, statement dates: a
// 1-day rendering offset would be a trust-breaking bug for a civic tool.
//
// Why this exists:
//   new Date('2026-06-02') parses as UTC midnight (2026-06-02T00:00:00Z),
//   then .toLocaleDateString('en-US') in any timezone west of UTC renders
//   the previous day. NJ-07 election on 2026-06-02 would show "June 1".
//
// Fix: parse the string as local midnight, then format normally.

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Parse a YYYY-MM-DD or full ISO timestamp as a Date in the LOCAL timezone.
 * Returns null on invalid input. ISO timestamps with explicit time/zone
 * pass through to native Date parsing.
 */
export function parseLocalDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const m = ISO_DATE_RE.exec(input);
  if (!m) return null;
  // If input is just YYYY-MM-DD (no time component), construct in local TZ.
  if (input.length === 10) {
    const [, y, mo, d] = m;
    return new Date(Number(y), Number(mo) - 1, Number(d));
  }
  // Input includes a time component — let native Date parse it.
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Format an ISO date string for display, using the local timezone.
 * Falls back to the raw input if parsing fails.
 */
export function formatLocalDate(
  input: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }
): string {
  const d = parseLocalDate(input);
  if (!d) return input ?? '';
  return d.toLocaleDateString('en-US', options);
}

/**
 * Days from `nowMs` to the local-midnight of the given ISO date string.
 * Negative values clamped to 0. Returns 0 on parse failure.
 */
export function daysUntilLocalDate(
  isoDate: string | null | undefined,
  nowMs: number
): number {
  const d = parseLocalDate(isoDate);
  if (!d) return 0;
  return Math.max(0, Math.ceil((d.getTime() - nowMs) / (1000 * 60 * 60 * 24)));
}
