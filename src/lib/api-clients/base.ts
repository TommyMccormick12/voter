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
}

let lastRequestAt = 0;
const MIN_GAP_MS = 250;

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

  console.log(`[fetch] ${url}`);
  const res = await fetch(url, { headers: options.headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${url}: ${await res.text().catch(() => '')}`);
  }

  const ct = res.headers.get('content-type') ?? '';
  let body: unknown;
  if (ct.includes('application/json')) {
    body = await res.json();
  } else {
    // Wrap text in {body, status} so the cache file is always valid JSON
    body = { body: await res.text(), status: res.status, content_type: ct };
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

  console.log(`[fetch:browser] ${url}`);
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

function sleep(ms: number): Promise<void> {
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
