// Regression tests for /cso Finding 2 — LLM cost amplification.
// These ensure that the token-bucket caps are enforced and that 429
// responses include the retry-after window.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkRateLimits,
  __resetBucketsForTests,
  MATCH_LIMITS,
} from '@/lib/rate-limit';

describe('rate-limit', () => {
  beforeEach(() => {
    __resetBucketsForTests();
  });

  it('allows requests up to capacity per session', () => {
    const session = 'sess-A';
    const ip = '1.2.3.4';
    for (let i = 0; i < MATCH_LIMITS.session.capacity; i++) {
      const r = checkRateLimits({
        sessionId: session,
        ip,
        sessionLimit: MATCH_LIMITS.session,
        ipLimit: MATCH_LIMITS.ip,
      });
      expect(r.allowed).toBe(true);
    }
    // 11th call should fail on session bucket first
    const denied = checkRateLimits({
      sessionId: session,
      ip,
      sessionLimit: MATCH_LIMITS.session,
      ipLimit: MATCH_LIMITS.ip,
    });
    expect(denied.allowed).toBe(false);
    expect(denied.exceeded).toBe('session');
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('blocks IP bucket even when sessions rotate', () => {
    // Attacker rotates session cookies but stays on one IP.
    const ip = '5.6.7.8';
    let allowed = 0;
    for (let i = 0; i < 60; i++) {
      const r = checkRateLimits({
        sessionId: `sess-${i}`,
        ip,
        sessionLimit: MATCH_LIMITS.session,
        ipLimit: MATCH_LIMITS.ip,
      });
      if (r.allowed) allowed++;
    }
    expect(allowed).toBe(MATCH_LIMITS.ip.capacity);
  });

  it('returns retryAfterSeconds >= 1 when over limit', () => {
    for (let i = 0; i < MATCH_LIMITS.session.capacity; i++) {
      checkRateLimits({
        sessionId: 'sess-X',
        ip: '9.9.9.9',
        sessionLimit: MATCH_LIMITS.session,
        ipLimit: MATCH_LIMITS.ip,
      });
    }
    const denied = checkRateLimits({
      sessionId: 'sess-X',
      ip: '9.9.9.9',
      sessionLimit: MATCH_LIMITS.session,
      ipLimit: MATCH_LIMITS.ip,
    });
    expect(denied.allowed).toBe(false);
    // Retry window is bounded by the smaller bucket (session: 10/hr → ~360s/token)
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('handles missing session/ip without crashing', () => {
    const r = checkRateLimits({
      sessionId: null,
      ip: null,
      sessionLimit: MATCH_LIMITS.session,
      ipLimit: MATCH_LIMITS.ip,
    });
    expect(r.allowed).toBe(true);
  });

  it('uses tight custom limits for synthetic traffic', () => {
    const tiny = { capacity: 2, windowMs: 60_000 };
    const r1 = checkRateLimits({
      sessionId: 's',
      ip: 'i',
      sessionLimit: tiny,
      ipLimit: tiny,
    });
    const r2 = checkRateLimits({
      sessionId: 's',
      ip: 'i',
      sessionLimit: tiny,
      ipLimit: tiny,
    });
    const r3 = checkRateLimits({
      sessionId: 's',
      ip: 'i',
      sessionLimit: tiny,
      ipLimit: tiny,
    });
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
  });
});
