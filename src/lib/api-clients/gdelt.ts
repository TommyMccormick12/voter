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
// docs. GDELT's rate limiter also does not return JSON on a 429 — it
// returns a plain-text "Please limit requests..." body even though we
// pass format=json, which base.ts's fetchCached wraps as `{body, status,
// content_type}` (its non-JSON fallback). parseArtlistResponse() below
// treats that shape as a loud failure rather than silently returning zero
// articles.

import { fetchCached, fetchCachedText } from './base';

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

/** GDELT enforces an undocumented per-IP rate limit ("Please limit
 * requests to one every 5 seconds") returned as HTTP 429 with a
 * plain-text body. Retrying with a gap comfortably above 5s recovers from
 * transient bursts (e.g. two candidates queried back to back) without
 * looping forever. */
export const MAX_GDELT_RETRY_ATTEMPTS = 3;
export const GDELT_RETRY_GAP_MS = 5500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
  /** YYYY-MM-DD, converted from GDELT's compact `seendate` stamp. */
  seenDate: string;
  domain: string;
  language: string;
  sourceCountry: string;
}

function seenDateToIso(seendate: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T/.exec(seendate);
  if (!m) return seendate.slice(0, 10); // defensive fallback, never throws on a format drift
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
 * Throws (never silently returns []) when the payload isn't the expected
 * artlist shape — covers both GDELT's plain-text rate-limit body (wrapped
 * by fetchCached as `{body, status, content_type}` because its
 * content-type isn't application/json) and a genuine schema drift where
 * `articles` exists but isn't an array. A missing `articles` key with no
 * `body` wrapper is treated as a legitimate zero-result response.
 */
export function parseArtlistResponse(data: unknown): GdeltArticle[] {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj.body === 'string' && !('articles' in obj)) {
      throw new Error(
        `[gdelt] non-JSON response from GDELT (likely rate-limited or an error page): ` +
          `${obj.body.slice(0, 200)}`,
      );
    }
    if ('articles' in obj && obj.articles !== undefined && !Array.isArray(obj.articles)) {
      throw new Error('[gdelt] malformed artlist response: "articles" is present but not an array');
    }
  }
  const articles = (data as RawGdeltArtlistResponse | undefined)?.articles;
  return (articles ?? []).map(normalizeArticle);
}

async function fetchArtlistWithRetry(url: string, cacheTag: string): Promise<unknown> {
  for (let attempt = 1; attempt <= MAX_GDELT_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fetchCached(url, { cacheTag });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimited = /HTTP 429/.test(msg);
      if (!isRateLimited || attempt === MAX_GDELT_RETRY_ATTEMPTS) throw err;
      console.warn(
        `[gdelt] rate-limited (attempt ${attempt}/${MAX_GDELT_RETRY_ATTEMPTS}) — waiting ${GDELT_RETRY_GAP_MS}ms`,
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
