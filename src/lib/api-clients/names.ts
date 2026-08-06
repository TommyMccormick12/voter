// Shared name-handling helpers for ingest scripts.
//
// Why this lives separately from fetch_fec.ts:
//   normalizeFecName has only one caller (fetch_fec), but stripTitles is
//   called by fetch_platform, fetch_votes, and fetch_campaign_site before
//   any external API lookup. Co-locating both helpers in one no-side-effect
//   module makes them trivially unit-testable.
//
// What the helpers solve (Phase 2D-ter §18; title-leak fix T08 2026-08-06):
//   1. FEC returns names ALL-CAPS LAST-FIRST ("CHERFILUS-MCCORMICK, SHEILA").
//      A naive lowercase + title-case loses internal capitalization on
//      Scottish/Irish/Dutch surnames ("Mccormick"). normalizeFecName fixes
//      this with a post-pass for Mc/Mac/O' prefixes.
//   2. FEC frequently embeds courtesy titles and suffixes inside the name
//      field ("SCOTT, RICK SEN", "FRANKLIN, SCOTT MR."). These are NOT
//      legitimate name components — they must never reach the display
//      name or the slug. normalizeFecName strips every TITLE_TOKENS word
//      from both the last-name and first/middle segments before
//      title-casing, so "Rick Sen Scott" / "Scott Mr. Franklin" style
//      leaks cannot occur. (Earlier versions of this module only stripped
//      titles at the external-API-lookup boundary via stripTitles and left
//      the display name/slug untouched — that was the bug. The 2026-08-06
//      audit found 33 fixture rows with a leaked title, e.g. "Gregory
//      Marcus Mr Carter", "Nizam Md, Jd Razack".)
//   3. stripTitles performs the same removal for callers (fetch_platform,
//      fetch_votes, fetch_campaign_site) that need a title-free name for
//      an external API lookup, given an already-assembled display name
//      rather than a raw "LAST, FIRST" FEC string.

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

/** Title-like tokens that FEC and Ballotpedia sometimes embed inside the
 * name string. Match is case-insensitive and tolerates trailing punctuation
 * (a period, or a comma left over when FEC chains multiple suffixes after
 * the first comma, e.g. "RAZACK, NIZAM MD, JD"). */
const TITLE_TOKENS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'sen',
  'rep',
  'hon',
  'rev',
  'reverend',
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
  'jd',
  'od',
]);

function isTitleToken(tok: string): boolean {
  const cleaned = tok.replace(/[.,;:]+$/, '').toLowerCase();
  return TITLE_TOKENS.has(cleaned);
}

/** Drop every title/honorific/suffix token from a list of words. Single-
 * letter or two-letter middle initials ("L", "E.") are preserved — those
 * are legitimate name components, not titles. */
function stripTitleWords(words: string[]): string[] {
  return words.filter((w) => w.length > 0 && !isTitleToken(w));
}

/**
 * Normalize FEC's "LAST, FIRST MIDDLE" format to "First Middle Last"
 * with internal capitalization preserved (McCormick, MacDonald, O'Connor),
 * and with every title/honorific/suffix token (Mr, Mrs, Ms, Dr, Sen, Rep,
 * Hon, Rev, Col, Jr, Sr, II/III/IV, Esq, PhD, MD, JD, OD) removed — FEC
 * embeds these inside either name segment ("SCOTT, RICK SEN", "FRANKLIN,
 * SCOTT MR.", "WHITE DR, VIBERT"), and none of them are legitimate given
 * or family name components. Removal happens before title-casing, so a
 * leaked title can never reach the display name or a slug built from it.
 *
 * Falls back to the same title-stripping + title-casing over a plain
 * word list when the input doesn't match the LAST, FIRST pattern
 * (already-normalized names, edge cases) — this keeps a title that leaked
 * through some other path from re-entering the pipeline if this function
 * is ever called a second time on its own prior output.
 */
export function normalizeFecName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const m = trimmed.match(/^([^,]+),\s*(.+)$/);
  if (!m) {
    return stripTitleWords(trimmed.split(/\s+/))
      .map(toTitleCase)
      .join(' ');
  }
  const last = stripTitleWords(m[1].split(/\s+/)).map(toTitleCase).join(' ');
  const rest = stripTitleWords(m[2].split(/\s+/)).map(toTitleCase).join(' ');
  return `${rest} ${last}`.trim();
}

/**
 * Strip courtesy/title tokens (Mr., Dr., Colonel Jr., etc.) from an
 * already-assembled display name before sending it to an external API
 * lookup (Wikipedia / GovTrack / NewsAPI). Single-letter middle initials
 * like "L" are preserved — those are legitimate name components, not
 * titles. Shares its token list and matching rule with normalizeFecName
 * so a title stripped from the display name is never one stripTitles
 * would have missed, or vice versa.
 *
 * Examples:
 *   "Scott Mr. Franklin"         → "Scott Franklin"
 *   "Walter L Dr. Campbell"      → "Walter L Campbell"  (L stays — initial)
 *   "Royal Mr. Webster Jr."      → "Royal Webster"
 *   "Maxwell Frost"              → "Maxwell Frost"      (no titles, unchanged)
 *   "Sheila Cherfilus-McCormick" → "Sheila Cherfilus-McCormick"
 */
export function stripTitles(displayName: string): string {
  return stripTitleWords(displayName.split(/\s+/)).join(' ');
}
