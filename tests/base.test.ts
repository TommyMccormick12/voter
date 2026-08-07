// Tests for src/lib/api-clients/base.ts's requireJson option (2026-08-07
// review finding 2 on feat/gdelt-statements): a 2xx response with a
// non-JSON content-type and a NON-EMPTY body must throw
// NonJsonResponseError and never be written to the disk cache — some free
// APIs (GDELT) serve a rate-limit/error page with HTTP 200, and caching
// that page would poison the query forever. An EMPTY non-JSON body is a
// legitimate zero-result response and is still cached normally.
//
// Unlike every other api-clients test file, this one exercises the REAL
// fetchCached (only the global `fetch` is mocked) — that's the point: the
// cache side effect on disk is what's under test. Writes land under
// supabase/seed/raw/example.test.invalid/ (gitignored) and are removed in
// beforeEach/afterEach.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  fetchCached,
  FetchHttpError,
  NonJsonResponseError,
  RAW_CACHE_DIR,
  sleep,
} from '@/lib/api-clients/base';

function mockResponse(opts: { status?: number; ok?: boolean; contentType?: string; body: string }) {
  const { status = 200, ok = true, contentType = 'application/json', body } = opts;
  return {
    ok,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

const TEST_HOST_DIR = join(RAW_CACHE_DIR, 'example.test.invalid');

describe('fetchCached requireJson (finding 2: refuse to cache a non-JSON 200 body)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    if (existsSync(TEST_HOST_DIR)) rmSync(TEST_HOST_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (existsSync(TEST_HOST_DIR)) rmSync(TEST_HOST_DIR, { recursive: true, force: true });
  });

  it('throws NonJsonResponseError on a non-empty non-JSON 200 body and never writes it to the cache', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        mockResponse({ contentType: 'text/html', body: 'Please limit requests to one every 5 seconds' }),
      ) as unknown as typeof fetch;

    await expect(
      fetchCached('https://example.test.invalid/poisoned-1', { requireJson: true, cacheTag: 't1' }),
    ).rejects.toThrow(NonJsonResponseError);

    expect(existsSync(TEST_HOST_DIR)).toBe(false);
  });

  it('a genuinely empty non-JSON body resolves as a normal zero-result wrapper and IS cached', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ contentType: 'text/html', body: '' }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const url = 'https://example.test.invalid/empty-1';

    const first = await fetchCached<{ body: string }>(url, { requireJson: true, cacheTag: 't2' });
    expect(first.body).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call must hit the cache, not fetch again.
    const second = await fetchCached<{ body: string }>(url, { requireJson: true, cacheTag: 't2' });
    expect(second.body).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('without requireJson, a non-JSON body is wrapped and cached exactly as before (back-compat)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(mockResponse({ contentType: 'text/html', body: 'some html' })) as unknown as typeof fetch;

    const result = await fetchCached<{ body: string }>('https://example.test.invalid/legacy-1', {
      cacheTag: 't3',
    });

    expect(result.body).toBe('some html');
  });

  it('throws FetchHttpError carrying the real status code on a non-2xx response', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(mockResponse({ ok: false, status: 429, body: 'rate limited' })) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await fetchCached('https://example.test.invalid/429-1', { cacheTag: 't4' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(FetchHttpError);
    expect((caught as FetchHttpError).status).toBe(429);
  });
});

describe('sleep (exported for reuse by per-service throttles like gdelt.ts)', () => {
  it('resolves only after the given delay elapses', async () => {
    vi.useFakeTimers();
    let resolved = false;
    const p = sleep(1000).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(resolved).toBe(true);

    vi.useRealTimers();
  });
});
