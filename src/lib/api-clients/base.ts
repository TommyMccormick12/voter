// Shared utilities for the data-pipeline API clients (scripts/ingest/*).
//
// Why this exists:
//   1. Disk caching — every API call is cached to supabase/seed/raw/. Re-runs
//      are free; failures resume instead of restarting.
//   2. Polite throttling — sequential requests with 250ms gap; sites like
//      Ballotpedia rate-limit aggressively, FEC bulk endpoints get cranky.
//   3. Required-key contract — every client throws clearly when its env var
//      is missing. No silent fallback to empty results.

import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const REPO_ROOT = process.cwd();
export const RAW_CACHE_DIR = join(REPO_ROOT, 'supabase', 'seed', 'raw');
export const CANDIDATE_FIXTURE_DIR = join(REPO_ROOT, 'supabase', 'seed', 'candidates');

export interface FetchOptions {
  /** Force a fresh fetch even if cache exists */
  force?: boolean;
  /** Cache key suffix (in addition to URL hash) */
  cacheTag?: string;
  /** Headers to send */
  headers?: Record<string, string>;
  /**
   * When true, a non-empty response body served with a non-JSON
   * content-type is treated as a failure (NonJsonResponseError, never
   * written to the disk cache) instead of being wrapped in
   * `{body,status,content_type}`. Some free APIs (e.g. GDELT) serve an
   * error/rate-limit page with HTTP 200 and a text/html content-type —
   * without this option, that page gets cached forever and every future
   * call for the same query silently "succeeds" with the poisoned body.
   * An EMPTY body still resolves normally (and is still cached) — that's
   * a legitimate empty/zero-result response, not an error page.
   */
  requireJson?: boolean;
}

let lastRequestAt = 0;
const MIN_GAP_MS = 250;

/** Non-2xx HTTP response. Carries the real status code so callers can
 * branch on it (e.g. retry on 429) without parsing the error message. */
export class FetchHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'FetchHttpError';
    this.status = status;
  }
}

/** A 2xx response whose body isn't the JSON the caller required (see
 * FetchOptions.requireJson) — thrown instead of cached. */
export class NonJsonResponseError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'NonJsonResponseError';
    this.status = status;
  }
}

/** Mask secret-bearing query parameters before a URL reaches logs or errors. */
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:api_key|apikey|key|token|access_token)=)[^&#]+/gi, '$1***');
}

/**
 * Throttled fetch with disk cache. Caches the response body keyed by
 * SHA-256 of (url + cacheTag). Cache invalidation: delete the file.
 */
export async function fetchCached<T = unknown>(
  url: string,
  options: FetchOptions = {}
): Promise<T> {
  const cachePath = cachePathFor(url, options.cacheTag);

  if (!options.force && existsSync(cachePath)) {
    const raw = readFileSync(cachePath, 'utf8');
    return JSON.parse(raw) as T;
  }

  // Polite throttle
  const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastRequestAt));
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  console.log(`[fetch] ${redactUrl(url)}`);
  const res = await fetch(url, { headers: options.headers });
  if (!res.ok) {
    throw new FetchHttpError(
      res.status,
      `HTTP ${res.status} on ${redactUrl(url)}: ${await res.text().catch(() => '')}`
    );
  }

  const ct = res.headers.get('content-type') ?? '';
  let body: unknown;
  if (ct.includes('application/json')) {
    body = await res.json();
  } else {
    const text = await res.text();
    if (options.requireJson && text.trim().length > 0) {
      throw new NonJsonResponseError(
        res.status,
        `Non-JSON response (content-type "${ct}") on ${redactUrl(url)}, refusing to cache: ${text.slice(0, 200)}`
      );
    }
    // Wrap text in {body, status} so the cache file is always valid JSON.
    // Reached either when the caller didn't ask for requireJson, or the
    // body is empty (a legitimate empty/zero-result response, not an
    // error page) — both cases are safe to cache.
    body = { body: text, status: res.status, content_type: ct };
  }

  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(body, null, 2));
  return body as T;
}

/** Read a string body (HTML/CSV/etc.) — fetchCached wraps these in {body}. */
export async function fetchCachedText(
  url: string,
  options: FetchOptions = {}
): Promise<string> {
  const wrapper = await fetchCached<{ body?: string }>(url, options);
  if (typeof wrapper === 'string') return wrapper;
  if (wrapper && typeof wrapper.body === 'string') return wrapper.body;
  throw new Error(`Unexpected wrapper shape for ${url}`);
}

// ============================================================
// Browser-rendered fetch (for sites with Cloudflare / JS challenges)
// ============================================================
//
// Ballotpedia and other "free-data" sites now sit behind Cloudflare's
// bot challenge. A plain HTTP fetch returns 202 with an empty body —
// the challenge requires JS execution to clear. Playwright renders the
// page in a real Chromium, waits for the content to load, then we cache
// the resulting HTML through the same cache layer as fetchCached.
//
// Cost: ~1-3 seconds per URL (browser startup is shared across calls,
// then each page load takes a couple seconds while the challenge clears).
// Cache means we pay this once per page per release.
//
// Caller pattern:
//   const html = await fetchBrowserCachedText(url, { cacheTag: '...' });
//   // ... at end of script:
//   await closeBrowser();

// Lazy-import Playwright so non-browser scripts don't pay the import cost.
let _browser: import('playwright').Browser | null = null;
let _browserContext: import('playwright').BrowserContext | null = null;

async function getBrowserContext(): Promise<import('playwright').BrowserContext> {
  if (_browserContext) return _browserContext;
  const { chromium } = await import('playwright');
  _browser = await chromium.launch({ headless: true });
  _browserContext = await _browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });
  return _browserContext;
}

/**
 * Close the shared browser. Call once at the end of a script that used
 * fetchBrowserCachedText. Without this, Node won't exit cleanly until
 * the Chromium process is reaped by the OS.
 */
export async function closeBrowser(): Promise<void> {
  if (_browserContext) {
    await _browserContext.close();
    _browserContext = null;
  }
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

/**
 * Browser-rendered, disk-cached page fetch. Uses Playwright to clear
 * Cloudflare JS challenges, then caches the HTML body identically to
 * fetchCachedText (the cache file is interchangeable; only the fetch
 * path differs).
 *
 * The cacheTag should be distinct from plain fetchCached entries for
 * the same URL — that's the caller's responsibility. We don't auto-mix
 * because a Playwright-rendered page may have JS-injected content the
 * raw HTML doesn't.
 */
export async function fetchBrowserCachedText(
  url: string,
  options: FetchOptions = {}
): Promise<string> {
  const cachePath = cachePathFor(url, options.cacheTag);

  if (!options.force && existsSync(cachePath)) {
    const raw = readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as { body?: string };
    if (typeof parsed.body === 'string' && parsed.body.length > 0) {
      return parsed.body;
    }
    // Cached empty/short body — fall through to re-fetch. This handles the
    // case where an earlier non-browser fetch cached a 202 Cloudflare stub.
  }

  // Polite throttle (same gap as fetchCached)
  const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastRequestAt));
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  console.log(`[fetch:browser] ${redactUrl(url)}`);
  const ctx = await getBrowserContext();
  const page = await ctx.newPage();
  try {
    // 'domcontentloaded' fires fast even if more network calls follow;
    // 'networkidle' waits for the JS challenge to settle. Slower but
    // catches Cloudflare's interstitial → real page transition.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // If we landed on a Cloudflare challenge page, wait for it to clear.
    // The challenge page typically shows "Just a moment..." or "Verify";
    // the real page replaces the body within a few seconds.
    const title = await page.title().catch(() => '');
    if (/just a moment|attention required|verify/i.test(title)) {
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    }

    const html = await page.content();
    const body = { body: html, status: 200, content_type: 'text/html' };
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(body, null, 2));
    return html;
  } finally {
    await page.close();
  }
}

function cachePathFor(url: string, tag?: string): string {
  const hash = createHash('sha256')
    .update(url + (tag ?? ''))
    .digest('hex')
    .slice(0, 16);
  // Group by host for human navigability
  const host = safeHost(url);
  return join(RAW_CACHE_DIR, host, `${hash}.json`);
}

function safeHost(url: string): string {
  try {
    return new URL(url).host.replace(/[^a-z0-9.-]/gi, '_');
  } catch {
    return 'unknown';
  }
}

/** Exported so callers with their own stricter per-service throttle (e.g.
 * gdelt.ts's proactive rate-limit spacing) reuse this instead of a private
 * copy. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing env var ${name}. Add it to .env.local or export it before running this script.`
    );
  }
  return v;
}

export function writeFixture(filename: string, data: unknown): string {
  mkdirSync(CANDIDATE_FIXTURE_DIR, { recursive: true });
  const path = join(CANDIDATE_FIXTURE_DIR, filename);
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`[write] ${path}`);
  return path;
}

export function readFixture<T = unknown>(filename: string): T {
  const path = join(CANDIDATE_FIXTURE_DIR, filename);
  if (!existsSync(path)) {
    throw new Error(`Fixture not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
