// Tests for src/lib/api-clients/gdelt.ts.
//
// Covers:
//   - the pinned wire shape (top-level `articles`, row keys url/title/
//     seendate/domain/language/sourcecountry — confirmed live 2026-08-07,
//     see the client's file header) and the seendate -> seenDate ISO
//     conversion, including the format-drift -> null fallback (finding 8,
//     2026-08-07 review).
//   - malformed-response loud failure: a non-empty non-JSON body (GDELT's
//     rate-limit/error page) must throw, not silently resolve to zero
//     articles — but a genuinely EMPTY body is a legitimate zero-result
//     response and must NOT throw (finding 7).
//   - domain-pin + timespan + maxrecords query construction, and that
//     every request asks fetchCached for requireJson: true (finding 2).
//   - the maxRecords ceiling and the retry behavior on both a real 429
//     (FetchHttpError) and a poisoned-200 non-JSON body
//     (NonJsonResponseError) — finding 2's "retries, never permanently
//     poisoned" fix. See tests/base.test.ts for the companion coverage
//     that a non-JSON 200 body is never written to the disk cache.
//
// fetchCached is mocked (same importActual pattern as congress-gov.test.ts
// / wikidata.test.ts) so no real network call or disk cache write happens.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  searchArticles,
  parseArtlistResponse,
  FLORIDA_NEWS_DOMAINS,
  MAX_MAXRECORDS,
  MAX_GDELT_RETRY_ATTEMPTS,
  GDELT_RETRY_GAP_MS,
  __resetGdeltThrottleForTests,
} from '@/lib/api-clients/gdelt';
import { fetchCached, FetchHttpError, NonJsonResponseError } from '@/lib/api-clients/base';

vi.mock('@/lib/api-clients/base', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-clients/base')>(
    '@/lib/api-clients/base',
  );
  return {
    ...actual,
    fetchCached: vi.fn(),
  };
});

const mockFetchCached = vi.mocked(fetchCached);

beforeEach(() => {
  mockFetchCached.mockReset();
  __resetGdeltThrottleForTests();
});

describe('wire shape (confirmed live 2026-08-07 via curl)', () => {
  it('parses the real top-level `articles` array and the real row keys', async () => {
    mockFetchCached.mockResolvedValueOnce({
      articles: [
        {
          url: 'https://www.floridapolitics.com/archives/some-article',
          url_mobile: 'https://www.floridapolitics.com/archives/some-article?amp',
          title: 'Anna Paulina Luna files for reelection',
          seendate: '20260615T104500Z',
          socialimage: 'https://www.floridapolitics.com/some.png',
          domain: 'floridapolitics.com',
          language: 'English',
          sourcecountry: 'United States',
        },
      ],
    });

    const result = await searchArticles('"Anna Paulina Luna"');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      url: 'https://www.floridapolitics.com/archives/some-article',
      title: 'Anna Paulina Luna files for reelection',
      seenDate: '2026-06-15', // converted from the compact 20260615T104500Z stamp
      domain: 'floridapolitics.com',
      language: 'English',
      sourceCountry: 'United States',
    });
  });

  it('treats a missing `articles` key with no `body` wrapper as zero results, not an error', async () => {
    mockFetchCached.mockResolvedValueOnce({});
    const result = await searchArticles('nobody notable');
    expect(result).toEqual([]);
  });

  it('finding 8: a seendate that does not match the expected format yields seenDate: null, never a sliced guess', async () => {
    mockFetchCached.mockResolvedValueOnce({
      articles: [
        {
          url: 'https://www.floridapolitics.com/archives/weird-date',
          title: 'Some article',
          seendate: 'not-a-real-timestamp',
          domain: 'floridapolitics.com',
          language: 'English',
          sourcecountry: 'United States',
        },
      ],
    });

    const result = await searchArticles('"Some Candidate"');

    expect(result[0].seenDate).toBeNull();
  });
});

describe('parseArtlistResponse malformed-response loud failure', () => {
  it('throws on a NON-EMPTY plain-text rate-limit body fetchCached wraps as {body,...}', () => {
    const wrapped = {
      body: 'Please limit requests to one every 5 seconds or contact kalev.leetaru5@gmail.com for larger queries.',
      status: 429,
      content_type: 'text/html; charset=utf-8',
    };
    expect(() => parseArtlistResponse(wrapped)).toThrow(/non-JSON response from GDELT/);
  });

  it('finding 7: does NOT throw on an EMPTY {body: "", ...} wrapper — treats it as zero results', () => {
    const wrapped = { body: '', status: 200, content_type: 'text/html; charset=utf-8' };
    expect(() => parseArtlistResponse(wrapped)).not.toThrow();
    expect(parseArtlistResponse(wrapped)).toEqual([]);
  });

  it('throws when `articles` is present but not an array (schema drift)', () => {
    expect(() => parseArtlistResponse({ articles: 'oops' })).toThrow(
      /malformed artlist response/,
    );
  });

  it('does not throw on a genuine empty-object zero-result response', () => {
    expect(() => parseArtlistResponse({})).not.toThrow();
    expect(parseArtlistResponse({})).toEqual([]);
  });
});

describe('query construction: domain pin + timespan + maxrecords', () => {
  it('OR-joins FLORIDA_NEWS_DOMAINS as domainis: clauses, floridapolitics.com first', async () => {
    mockFetchCached.mockResolvedValueOnce({ articles: [] });

    await searchArticles('"Some Candidate"');

    const url = mockFetchCached.mock.calls[0][0] as string;
    const decoded = decodeURIComponent(url);
    expect(FLORIDA_NEWS_DOMAINS[0]).toBe('floridapolitics.com');
    expect(decoded).toContain('domainis:floridapolitics.com OR domainis:tampabay.com');
    expect(decoded).toContain('mode=artlist');
    expect(decoded).toContain('format=json');
    expect(decoded).toContain('timespan=6months'); // default
  });

  it('finding 2: every request asks fetchCached for requireJson so a poisoned 200 body is never cached', async () => {
    mockFetchCached.mockResolvedValueOnce({ articles: [] });

    await searchArticles('"Some Candidate"');

    expect(mockFetchCached.mock.calls[0][1]).toMatchObject({ requireJson: true });
  });

  it('passes a caller-supplied domain list and timespan through verbatim', async () => {
    mockFetchCached.mockResolvedValueOnce({ articles: [] });

    await searchArticles('"Some Candidate"', { domains: ['example.com'], timespan: '3months', maxRecords: 5 });

    const url = mockFetchCached.mock.calls[0][0] as string;
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('domainis:example.com');
    expect(decoded).not.toContain('floridapolitics.com');
    expect(decoded).toContain('timespan=3months');
    expect(decoded).toContain('maxrecords=5');
  });

  it('omits the domain clause entirely when domains is []', async () => {
    mockFetchCached.mockResolvedValueOnce({ articles: [] });

    await searchArticles('"Some Candidate"', { domains: [] });

    const url = mockFetchCached.mock.calls[0][0] as string;
    expect(decodeURIComponent(url)).not.toContain('domainis:');
  });

  it('rejects a maxRecords above GDELT\'s documented ceiling before ever calling fetchCached', async () => {
    await expect(searchArticles('x', { maxRecords: MAX_MAXRECORDS + 1 })).rejects.toThrow(
      /exceeds GDELT's documented ceiling/,
    );
    expect(mockFetchCached).not.toHaveBeenCalled();
  });
});

describe('retry behavior (GDELT\'s undocumented per-IP rate limit)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries after a real 429 (FetchHttpError) and succeeds within the attempt cap', async () => {
    mockFetchCached
      .mockRejectedValueOnce(new FetchHttpError(429, 'HTTP 429 on https://api.gdeltproject.org/...: rate limited'))
      .mockResolvedValueOnce({ articles: [] });

    const promise = searchArticles('"Some Candidate"');
    await vi.advanceTimersByTimeAsync(GDELT_RETRY_GAP_MS);
    const result = await promise;

    expect(result).toEqual([]);
    expect(mockFetchCached).toHaveBeenCalledTimes(2);
  });

  it('finding 2: retries after a poisoned-200 NonJsonResponseError and succeeds, instead of a permanent failure', async () => {
    mockFetchCached
      .mockRejectedValueOnce(
        new NonJsonResponseError(200, 'Non-JSON response (content-type "text/html") — refusing to cache'),
      )
      .mockResolvedValueOnce({ articles: [] });

    const promise = searchArticles('"Some Candidate"');
    await vi.advanceTimersByTimeAsync(GDELT_RETRY_GAP_MS);
    const result = await promise;

    expect(result).toEqual([]);
    expect(mockFetchCached).toHaveBeenCalledTimes(2);
  });

  it('gives up loudly after MAX_GDELT_RETRY_ATTEMPTS, never looping forever', async () => {
    mockFetchCached.mockRejectedValue(new FetchHttpError(429, 'HTTP 429 on https://api.gdeltproject.org/...: rate limited'));

    const promise = searchArticles('"Some Candidate"');
    // Swallow the eventual rejection so it isn't reported as unhandled
    // while we advance fake timers below.
    promise.catch(() => {});
    for (let i = 0; i < MAX_GDELT_RETRY_ATTEMPTS; i++) {
      await vi.advanceTimersByTimeAsync(GDELT_RETRY_GAP_MS);
    }

    await expect(promise).rejects.toThrow(/HTTP 429/);
    expect(mockFetchCached).toHaveBeenCalledTimes(MAX_GDELT_RETRY_ATTEMPTS);
  });

  it('does not retry a non-429 FetchHttpError — fails on the first attempt', async () => {
    mockFetchCached.mockRejectedValueOnce(
      new FetchHttpError(500, 'HTTP 500 on https://api.gdeltproject.org/...: server error'),
    );

    await expect(searchArticles('"Some Candidate"')).rejects.toThrow(/HTTP 500/);
    expect(mockFetchCached).toHaveBeenCalledTimes(1);
  });

  it('does not retry a plain Error that is neither a 429 nor a non-JSON response', async () => {
    mockFetchCached.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(searchArticles('"Some Candidate"')).rejects.toThrow(/ECONNRESET/);
    expect(mockFetchCached).toHaveBeenCalledTimes(1);
  });
});
