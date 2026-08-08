// GDELT DOC 2.0 API client — free, keyless full-text news search.
//
// Replaces the retired NewsAPI ingester slot (fetch_news_statements.ts) as
// the tertiary stance source (Decision 5, DECISIONS-2026-08-06.md: "GDELT
// news mining (replaces NewsAPI)").
//
// Docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
// Auth: none — GDELT DOC 2.0 is free and keyless. No requireEnv() call
//   anywhere in this file, unlike congress-gov.ts.
// Endpoint family: https://api.gdeltproject.org/api/v2/doc/doc
//   query=... mode=artlist format=json, plus domain and timespan filters.
//
// WIRE SHAPE (confirmed live 2026-08-07, via `curl` — see
// tests/gdelt.test.ts for the pinned fixture): the top-level response is
// `{"articles": [...]}`, and each row is
//   { url, url_mobile, title, seendate, socialimage, domain, language, sourcecountry }
// `seendate` is GDELT's compact UTC stamp ("20260615T104500Z"), NOT
// ISO-8601 — converted to a plain YYYY-MM-DD by seenDateToIso() below. This
// is the same class of bug the Congress.gov client hit on 2026-08-07
// (bioguideId vs bioguideID): pin the observed spelling, don't guess from
// docs. GDELT's rate limiter also does not reliably return JSON on a
// failure — it can serve a plain-text "Please limit requests..." body as
// either HTTP 429 or, worse, HTTP 200 with a non-JSON content-type (the
// latter would otherwise get disk-cached forever by fetchCached and
// "succeed" with a poisoned body on every future run). fetchArtlistWithRetry
// below asks fetchCached for `requireJson: true` specifically to turn that
// second case into a retryable NonJsonResponseError instead of a cache
// write; parseArtlistResponse() still validates the parsed shape as a
// second layer of defense.

import {
  fetchCached,
  fetchCachedText,
  sleep,
  FetchHttpError,
  NonJsonResponseError,
} from './base';

const BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

/** Florida outlets to domain-pin queries against. floridapolitics.com is
 * listed first (highest yield for FL primary coverage per the ticket);
 * the rest are major statewide/regional outlets likely to cover federal
 * primary candidates. Order only affects the query string, not results. */
export const FLORIDA_NEWS_DOMAINS = [
  'floridapolitics.com',
  'tampabay.com',
  'orlandosentinel.com',
  'miamiherald.com',
  'news-press.com',
  'tallahassee.com',
] as const;

const DEFAULT_TIMESPAN = '6months';

/** GDELT's documented ceiling on maxrecords for the DOC API. Requesting
 * above this either clamps or errors server-side; we refuse client-side
 * first so a bad caller value fails loudly instead of silently clamping. */
export const MAX_MAXRECORDS = 250;

/** Conservative per-candidate default — keeps a single query to a
 * reviewable article count rather than flooding the attach step. */
export const DEFAULT_MAXRECORDS = 25;

/** Read a positive integer from the environment, else use the default.
 * A missing, empty, non-numeric, or non-positive value takes the default,
 * so a malformed override can never disable pacing and start a 429 storm. */
function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** GDELT enforces an undocumented per-IP rate limit ("Please limit
 * requests to one every 5 seconds") returned as HTTP 429 or (see file
 * header) HTTP 200 with a non-JSON body. Retrying with a gap comfortably
 * above 5s recovers from transient bursts without looping forever.
 *
 * The three pacing values below are env-overridable. The defaults are the
 * interactive-run values and are unchanged. A large batch sweep (every
 * candidate in every race) sustains far more requests than a single-race
 * ingest, and GDELT tightens its limit under that load — such a run sets
 * GDELT_MIN_SEARCH_GAP_MS / GDELT_RETRY_GAP_MS / GDELT_MAX_RETRY_ATTEMPTS
 * higher rather than accepting a sweep where every candidate 429s. */
export const MAX_GDELT_RETRY_ATTEMPTS = envInt('GDELT_MAX_RETRY_ATTEMPTS', 3);
export const GDELT_RETRY_GAP_MS = envInt('GDELT_RETRY_GAP_MS', 5500);

/**
 * Proactive spacing between GDELT search requests, independent of the
 * retry backoff above. base.ts's shared fetchCached throttle is only
 * 250ms — nowhere near GDELT's ~1-per-5s per-IP limit — so back-to-back
 * candidate searches in the same ingest run would predictably 429 without
 * this. Applied before every attempt (not just the first), so it's a
 * no-op whenever the previous attempt's own GDELT_RETRY_GAP_MS wait has
 * already covered the gap.
 */
const GDELT_MIN_SEARCH_GAP_MS = envInt('GDELT_MIN_SEARCH_GAP_MS', 5000);
let lastGdeltSearchAt = 0;

async function throttleGdeltSearch(): Promise<void> {
  const wait = Math.max(0, GDELT_MIN_SEARCH_GAP_MS - (Date.now() - lastGdeltSearchAt));
  if (wait > 0) await sleep(wait);
  lastGdeltSearchAt = Date.now();
}

/** Test-only: reset the proactive-throttle clock. Without this, a test
 * file's first searchArticles() call after an earlier test in the same
 * module instance would inherit a recent lastGdeltSearchAt and block for
 * up to GDELT_MIN_SEARCH_GAP_MS of real time. Not part of the client's
 * public contract — call from a test's beforeEach only. */
export function __resetGdeltThrottleForTests(): void {
  lastGdeltSearchAt = 0;
}

// ============================================================
// Types — the slice of the GDELT DOC 2.0 artlist response we read
// ============================================================

/** Raw wire shape of one artlist row, spelled exactly as GDELT emits it
 * (snake-ish lowercase, not camelCase — confirmed live 2026-08-07). */
interface RawGdeltArticle {
  url: string;
  url_mobile?: string;
  title: string;
  seendate: string;
  socialimage?: string;
  domain: string;
  language: string;
  sourcecountry: string;
}

interface RawGdeltArtlistResponse {
  articles?: RawGdeltArticle[];
}

/** Normalized article row this client hands to callers. Thinner than the
 * raw wire row on purpose — url_mobile/socialimage are unused downstream. */
export interface GdeltArticle {
  url: string;
  title: string;
  /** YYYY-MM-DD, converted from GDELT's compact `seendate` stamp, or null
   * when that stamp doesn't match the expected format (never a sliced,
   * possibly-non-ISO guess — see seenDateToIso()). */
  seenDate: string | null;
  domain: string;
  language: string;
  sourceCountry: string;
}

/**
 * Parse GDELT's compact UTC stamp ("20260615T104500Z") into a plain
 * YYYY-MM-DD. Returns null (never a sliced guess) on a format drift —
 * an unvalidated non-ISO string flowing into `statement_date` can abort
 * the seed step AFTER its delete-then-insert has already run (see
 * scripts/seed/seed_candidates.ts), which would deactivate a live
 * candidate. null is a normal, already-handled value for statement_date
 * throughout the pipeline (e.g. fetch_statements.ts's extractDate).
 */
function seenDateToIso(seendate: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T/.exec(seendate);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function normalizeArticle(raw: RawGdeltArticle): GdeltArticle {
  return {
    url: raw.url,
    title: raw.title,
    seenDate: seenDateToIso(raw.seendate),
    domain: raw.domain,
    language: raw.language,
    sourceCountry: raw.sourcecountry,
  };
}

/**
 * Validate + normalize a raw fetchCached() result into GdeltArticle[].
 * Throws (never silently returns []) when the payload is a non-empty
 * non-JSON body (fetchCached's `{body, status, content_type}` fallback
 * wrapper) or a genuine schema drift where `articles` isn't an array. An
 * EMPTY body — `{body: ''}`, or no `articles` key at all — is a
 * legitimate zero-result response, not a failure: throwing on it would
 * (via the ingest script's stale-data replacement) wipe out every
 * previously attached gdelt statement on a candidate that GDELT simply
 * has nothing new to say about this run.
 */
export function parseArtlistResponse(data: unknown): GdeltArticle[] {
  // Single cast covering both shapes this can actually be: GDELT's real
  // artlist response ({articles}) or fetchCached's non-JSON fallback
  // wrapper ({body, status, content_type}).
  const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown> &
    Partial<RawGdeltArtlistResponse> & { body?: unknown };

  if (typeof obj.body === 'string' && obj.body.length > 0 && !('articles' in obj)) {
    throw new Error(
      `[gdelt] non-JSON response from GDELT (likely rate-limited or an error page): ${obj.body.slice(0, 200)}`,
    );
  }
  if (obj.articles !== undefined && !Array.isArray(obj.articles)) {
    throw new Error('[gdelt] malformed artlist response: "articles" is present but not an array');
  }
  return (obj.articles ?? []).map(normalizeArticle);
}

async function fetchArtlistWithRetry(url: string, cacheTag: string): Promise<unknown> {
  for (let attempt = 1; attempt <= MAX_GDELT_RETRY_ATTEMPTS; attempt++) {
    await throttleGdeltSearch();
    try {
      return await fetchCached(url, { cacheTag, requireJson: true });
    } catch (err) {
      const retryable =
        (err instanceof FetchHttpError && err.status === 429) || err instanceof NonJsonResponseError;
      if (!retryable || attempt === MAX_GDELT_RETRY_ATTEMPTS) throw err;
      console.warn(
        `[gdelt] rate-limited or non-JSON response (attempt ${attempt}/${MAX_GDELT_RETRY_ATTEMPTS}) — ` +
          `waiting ${GDELT_RETRY_GAP_MS}ms`,
      );
      await sleep(GDELT_RETRY_GAP_MS);
    }
  }
  // Unreachable: the loop above always returns or throws.
  throw new Error('[gdelt] fetchArtlistWithRetry: exhausted retries without a terminal result');
}

export interface SearchArticlesOptions {
  /** Domains to OR together as a `domainis:` clause. Defaults to
   * FLORIDA_NEWS_DOMAINS. Pass [] to search with no domain pin. */
  domains?: readonly string[];
  /** GDELT timespan token, e.g. "3months", "6months", "1year". */
  timespan?: string;
  maxRecords?: number;
}

/**
 * Full-text article search against GDELT DOC 2.0, domain-pinned to FL
 * outlets by default. `query` should already be caller-quoted where an
 * exact phrase match is wanted (e.g. `"Anna Paulina Luna"`) — this
 * function does not add its own quoting.
 */
export async function searchArticles(
  query: string,
  opts: SearchArticlesOptions = {},
): Promise<GdeltArticle[]> {
  const { domains = FLORIDA_NEWS_DOMAINS, timespan = DEFAULT_TIMESPAN, maxRecords = DEFAULT_MAXRECORDS } = opts;
  if (maxRecords > MAX_MAXRECORDS) {
    throw new Error(
      `[gdelt] searchArticles: maxRecords=${maxRecords} exceeds GDELT's documented ceiling of ${MAX_MAXRECORDS}`,
    );
  }
  const domainClause = domains.length > 0 ? ` (${domains.map((d) => `domainis:${d}`).join(' OR ')})` : '';
  const fullQuery = `${query}${domainClause}`;
  const url = `${BASE}?query=${encodeURIComponent(fullQuery)}&mode=artlist&maxrecords=${maxRecords}&timespan=${timespan}&format=json`;

  const data = await fetchArtlistWithRetry(url, 'gdeltdoc:artlist:v1');
  return parseArtlistResponse(data);
}

/**
 * Fetch and return the raw HTML of an article URL, disk-cached like every
 * other pipeline fetch. Separate from searchArticles because the DOC API
 * never returns article body text — only index metadata (see wire-shape
 * comment above) — so getting real statement text always requires this
 * second, per-article fetch.
 */
export async function fetchArticleHtml(url: string): Promise<string> {
  return fetchCachedText(url, { cacheTag: 'gdelt-article-v1' });
}
