// Shared name-handling helpers for ingest scripts.
//
// Why this lives separately from fetch_fec.ts:
//   normalizeFecName has only one caller (fetch_fec), but stripTitles is
//   called by fetch_platform, fetch_votes, and fetch_campaign_site before
//   any external API lookup. Co-locating both helpers in one no-side-effect
//   module makes them trivially unit-testable.
//
// What the helpers solve (Phase 2D-ter §18):
//   1. FEC returns names ALL-CAPS LAST-FIRST ("CHERFILUS-MCCORMICK, SHEILA").
//      A naive lowercase + title-case loses internal capitalization on
//      Scottish/Irish/Dutch surnames ("Mccormick"). normalizeFecName fixes
//      this with a post-pass for Mc/Mac/O' prefixes.
//   2. FEC frequently embeds courtesy titles inside the name field
//      ("Scott Mr. Franklin", "Walter L Dr. Campbell"). Display-side
//      they're fine; external-API-side they break Wikipedia and GovTrack
//      lookups. stripTitles removes them at the lookup boundary.

/** Title-cases a single word while preserving quoted nicknames and
 * hyphen / apostrophe segmentation. The first regex pass handles the
 * common case (`o'connor` → `O'Connor`). The SURNAME_PREFIXES pass
 * fixes Scottish/Irish/Dutch patterns the base regex can't reach
 * (`Mccormick` → `McCormick`).
 */
function toTitleCase(word: string): string {
  if (!word) return word;
  let out = word
    .toLowerCase()
    .replace(/(^|[\s'"\-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());

  // Mc + lowercase → Mc + uppercase. Universal: "Mccormick" → "McCormick",
  // "Mcdaniel" → "McDaniel", "Mcdonald" → "McDonald".
  out = out.replace(/\bMc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`);

  // Mac + lowercase + 3+ more lowercase → Mac + uppercase next.
  // Conservative: requires ≥3 trailing lowercase chars so we don't
  // mangle short non-Scottish surnames. "Macy", "Mack", "Macedo" stay
  // unchanged; "MacDonald", "MacKenzie", "MacAuley" get fixed.
  out = out.replace(
    /\bMac([a-z])([a-z]{3,})/g,
    (_, c, rest) => `Mac${c.toUpperCase()}${rest}`,
  );

  // O' + lowercase. The base regex already handles "o'connor" → "O'Connor"
  // because `'` is in its separator class, but list it explicitly so the
  // intent is documented and the post-pass is the single source of truth
  // for surname-prefix logic.
  out = out.replace(/\bO'([a-z])/g, (_, c) => `O'${c.toUpperCase()}`);

  return out;
}

/**
 * Normalize FEC's "LAST, FIRST MIDDLE" format to "First Middle Last"
 * with internal capitalization preserved (McCormick, MacDonald, O'Connor).
 *
 * Returns the input unchanged when it doesn't match the LAST, FIRST pattern
 * (already-normalized names, edge cases).
 */
export function normalizeFecName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const m = trimmed.match(/^([^,]+),\s*(.+)$/);
  if (!m) return trimmed;
  const last = m[1].split(/\s+/).map(toTitleCase).join(' ');
  const rest = m[2].split(/\s+/).map(toTitleCase).join(' ');
  return `${rest} ${last}`;
}

/** Title-like tokens that FEC and Ballotpedia sometimes embed inside the
 * name string. Match is case-insensitive and tolerates a trailing dot. */
const TITLE_TOKENS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'sen',
  'rep',
  'hon',
  'col',
  'colonel',
  'jr',
  'sr',
  'ii',
  'iii',
  'iv',
  'esq',
  'phd',
  'md',
]);

/**
 * Strip courtesy/title tokens (Mr., Dr., Colonel Jr., etc.) from a
 * display name before sending it to an external API lookup. Single-letter
 * middle initials like "L" are preserved — those are legitimate name
 * components, not titles.
 *
 * Use this at the boundary of any Wikipedia / GovTrack / NewsAPI query.
 * The display name in the fixture keeps its title tokens (the user sees
 * exactly what FEC filed).
 *
 * Examples:
 *   "Scott Mr. Franklin"         → "Scott Franklin"
 *   "Walter L Dr. Campbell"      → "Walter L Campbell"  (L stays — initial)
 *   "Royal Mr. Webster Jr."      → "Royal Webster"
 *   "Maxwell Frost"              → "Maxwell Frost"      (no titles, unchanged)
 *   "Sheila Cherfilus-McCormick" → "Sheila Cherfilus-McCormick"
 */
export function stripTitles(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter((tok) => {
      const cleaned = tok.replace(/\.$/, '').toLowerCase();
      return !TITLE_TOKENS.has(cleaned);
    })
    .join(' ');
}
