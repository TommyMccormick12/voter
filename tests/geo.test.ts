// Regression tests for /cso Finding 1 — IP/UA hash reversibility.
// These pin the HMAC-keyed hashing behavior so the public-salt regression
// can't recur.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hashIp, hashUserAgent } from '@/lib/geo';

describe('geo: privacy-preserving hashing', () => {
  const originalSecret = process.env.IP_HASH_SECRET;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.IP_HASH_SECRET =
      'test-secret-32-bytes-long-enough-for-tests-1234';
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.IP_HASH_SECRET;
    else process.env.IP_HASH_SECRET = originalSecret;
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });

  it('hashIp returns null for null/undefined input', () => {
    expect(hashIp(null)).toBeNull();
    expect(hashIp(undefined)).toBeNull();
  });

  it('hashIp returns a hex digest (HMAC-SHA-256 = 64 hex chars)', () => {
    const h = hashIp('1.2.3.4');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashIp is deterministic within a single call (same input → same output)', () => {
    const a = hashIp('1.2.3.4');
    const b = hashIp('1.2.3.4');
    expect(a).toBe(b);
  });

  it('hashIp differs across IPs', () => {
    const a = hashIp('1.2.3.4');
    const b = hashIp('1.2.3.5');
    expect(a).not.toBe(b);
  });

  it('hashUserAgent returns null for null/undefined input', () => {
    expect(hashUserAgent(null)).toBeNull();
    expect(hashUserAgent(undefined)).toBeNull();
  });

  it('hashUserAgent returns a hex digest', () => {
    const h = hashUserAgent('Mozilla/5.0 ...');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('production refuses to hash with a missing secret (returns null)', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.IP_HASH_SECRET;
    process.env.NODE_ENV = 'production';
    // Returns null — refuses to write reversible hashes when secret is missing.
    expect(hashIp('1.2.3.4')).toBeNull();
    expect(hashUserAgent('Mozilla/5.0 ...')).toBeNull();
    errSpy.mockRestore();
  });

  it('production refuses to hash with a too-short secret', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.IP_HASH_SECRET = 'short';
    process.env.NODE_ENV = 'production';
    expect(hashIp('1.2.3.4')).toBeNull();
    errSpy.mockRestore();
  });
});
