// Rate limiter — sliding-window per identifier, backed by Upstash Redis
// when configured, with an in-memory token-bucket fallback for local dev
// and preview deploys that haven't provisioned Upstash yet.
//
// Why distributed: in-memory counters were per-Lambda. On Vercel's
// serverless model, a cold-start instance multiplication let an attacker
// hitting concurrent workers multiply their effective budget by N
// (number of warm instances). Upstash is shared state across every
// Lambda invocation — counters survive scale-out and cold starts.
//
// Setup: provision Upstash Redis from the Vercel Marketplace; it auto-
// populates `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
// Without those env vars, the limiter silently falls back to in-memory
// (good for `npm run dev` and CI where Redis isn't worth the setup).
//
// Used by /api/match (LLM cost protection per /cso Finding 2) and the
// four engagement-capture write APIs (/cso §19.2).

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

interface Bucket {
  /** Tokens currently available */
  tokens: number;
  /** When this bucket was last refilled (ms epoch) */
  lastRefillAt: number;
}

interface Limit {
  /** Max requests allowed in the window */
  capacity: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  /** True if the request was allowed */
  allowed: boolean;
  /** Tokens remaining after this check */
  remaining: number;
  /** Seconds until the next token would refill (for Retry-After header) */
  retryAfterSeconds: number;
  /** Which limit was exceeded, if any */
  exceeded?: 'session' | 'ip';
}

// ─── Upstash path ──────────────────────────────────────────────────────

const HAS_UPSTASH = Boolean(
  process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN,
);

// Singleton Redis client. Reused across every invocation in the same
// Lambda; cheap to construct but no reason to repeat.
const redis: Redis | null = HAS_UPSTASH ? Redis.fromEnv() : null;

// One Ratelimit per (capacity, windowMs) tuple — cached so we don't
// reconstruct on every request. Keyed by a string so distinct limits
// with the same numbers share an instance (correct behavior, since they
// share the same Redis namespace via the prefix).
const limiterCache = new Map<string, Ratelimit>();

function getLimiter(limit: Limit): Ratelimit {
  if (!redis) {
    throw new Error('getLimiter called without Upstash configured');
  }
  const key = `${limit.capacity}:${limit.windowMs}`;
  let lim = limiterCache.get(key);
  if (!lim) {
    // Upstash duration literal is `${number} ms|s|m|h|d`. Type-cast the
    // template since TS can't narrow a dynamic number to a numeric
    // literal at compile time.
    const window = `${limit.windowMs} ms` as `${number} ms`;
    lim = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit.capacity, window),
      analytics: false,
      prefix: '@voter/rl',
    });
    limiterCache.set(key, lim);
  }
  return lim;
}

async function checkBucketUpstash(
  key: string,
  limit: Limit,
): Promise<RateLimitResult> {
  const lim = getLimiter(limit);
  const res = await lim.limit(key);
  return {
    allowed: res.success,
    remaining: res.remaining,
    retryAfterSeconds: res.success
      ? 0
      : Math.max(1, Math.ceil((res.reset - Date.now()) / 1000)),
  };
}

// ─── In-memory fallback ────────────────────────────────────────────────

const buckets = new Map<string, Bucket>();

let lastSweepAt = 0;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const STALE_BUCKET_MS = 2 * 60 * 60 * 1000;

function maybeSweep(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefillAt > STALE_BUCKET_MS) {
      buckets.delete(key);
    }
  }
  lastSweepAt = now;
}

function checkBucketInMemory(
  key: string,
  limit: Limit,
  now: number,
): RateLimitResult {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: limit.capacity, lastRefillAt: now };
    buckets.set(key, bucket);
  }

  const elapsed = now - bucket.lastRefillAt;
  const refillRate = limit.capacity / limit.windowMs;
  const refilled = Math.floor(elapsed * refillRate);
  if (refilled > 0) {
    bucket.tokens = Math.min(limit.capacity, bucket.tokens + refilled);
    bucket.lastRefillAt = now;
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return {
      allowed: true,
      remaining: bucket.tokens,
      retryAfterSeconds: 0,
    };
  }

  const msPerToken = limit.windowMs / limit.capacity;
  const retryAfterMs = Math.ceil(msPerToken - elapsed);
  return {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  };
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Rate-limit a request by both session and IP. Both limits must pass.
 *
 * Returns the first limit that fails (session checked first so legit users
 * with shared NAT addresses still get session-level fairness).
 *
 * Async because the Upstash backend is a network call. The in-memory
 * fallback is also wrapped in a resolved Promise for interface symmetry.
 */
export async function checkRateLimits(opts: {
  sessionId: string | null;
  ip: string | null;
  /** Per-session limit, e.g. {capacity: 10, windowMs: 3_600_000} for 10/hr */
  sessionLimit: Limit;
  /** Per-IP limit, e.g. {capacity: 30, windowMs: 3_600_000} for 30/hr */
  ipLimit: Limit;
}): Promise<RateLimitResult> {
  if (HAS_UPSTASH) {
    if (opts.sessionId) {
      const result = await checkBucketUpstash(
        `s:${opts.sessionId}`,
        opts.sessionLimit,
      );
      if (!result.allowed) return { ...result, exceeded: 'session' };
    }
    if (opts.ip) {
      const result = await checkBucketUpstash(
        `i:${opts.ip}`,
        opts.ipLimit,
      );
      if (!result.allowed) return { ...result, exceeded: 'ip' };
    }
    return {
      allowed: true,
      remaining: opts.sessionLimit.capacity,
      retryAfterSeconds: 0,
    };
  }

  const now = Date.now();
  maybeSweep(now);

  if (opts.sessionId) {
    const result = checkBucketInMemory(
      `s:${opts.sessionId}`,
      opts.sessionLimit,
      now,
    );
    if (!result.allowed) return { ...result, exceeded: 'session' };
  }

  if (opts.ip) {
    const result = checkBucketInMemory(`i:${opts.ip}`, opts.ipLimit, now);
    if (!result.allowed) return { ...result, exceeded: 'ip' };
  }

  return {
    allowed: true,
    remaining: opts.sessionLimit.capacity,
    retryAfterSeconds: 0,
  };
}

/** Test helper — clears all in-memory buckets. No-op when Upstash is configured. */
export function __resetBucketsForTests(): void {
  buckets.clear();
  lastSweepAt = 0;
}

// Standard limits for /api/match (LLM cost protection per /cso Finding 2).
export const MATCH_LIMITS = {
  session: { capacity: 10, windowMs: 60 * 60 * 1000 }, // 10/hr/session
  ip: { capacity: 30, windowMs: 60 * 60 * 1000 }, // 30/hr/IP
} as const;

// Limits for the 4 write APIs that capture engagement signal (Phase 2D-quat
// §19.2). Calibrated for legit traffic patterns; bot pollution of the
// B2B sentiment-data tables is the threat model.
//
// Interaction: carousel views + saves + detail clicks. Highest volume.
export const INTERACTION_LIMITS = {
  session: { capacity: 300, windowMs: 60 * 60 * 1000 },
  ip: { capacity: 1500, windowMs: 60 * 60 * 1000 },
} as const;

// Visit: page-nav start/end. One per page transition.
export const VISIT_LIMITS = {
  session: { capacity: 30, windowMs: 60 * 60 * 1000 },
  ip: { capacity: 100, windowMs: 60 * 60 * 1000 },
} as const;

// Quick-poll: 1-2 submissions per match flow. Cap protects B2B aggregation
// from bot-stuffed weight rows.
export const POLL_LIMITS = {
  session: { capacity: 30, windowMs: 60 * 60 * 1000 },
  ip: { capacity: 100, windowMs: 60 * 60 * 1000 },
} as const;

// Consent: banner clicks. 1-3 per session lifetime is typical.
export const CONSENT_LIMITS = {
  session: { capacity: 10, windowMs: 60 * 60 * 1000 },
  ip: { capacity: 30, windowMs: 60 * 60 * 1000 },
} as const;

// Report: user-submitted inaccuracy flags on candidate stances/votes.
// Low-volume legit traffic; abuse would be spam.
export const REPORT_LIMITS = {
  session: { capacity: 10, windowMs: 60 * 60 * 1000 },
  ip: { capacity: 30, windowMs: 60 * 60 * 1000 },
} as const;
