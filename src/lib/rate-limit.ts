// In-memory rate limiter — token-bucket per identifier.
//
// Caveat: counters are per Lambda instance. On Vercel serverless, an
// attacker hitting cold-start instances can multiply their effective
// budget by N (number of warm instances). This is still a 99% reduction
// vs no limit at all. For real production traffic, swap the in-memory
// store for Vercel KV or Upstash Redis (token bucket interface stays
// identical — only the storage layer changes).
//
// Used by /api/match to cap LLM cost amplification (see /cso Finding 2).

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

const buckets = new Map<string, Bucket>();

// Sweep stale buckets occasionally to avoid unbounded memory growth.
let lastSweepAt = 0;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
const STALE_BUCKET_MS = 2 * 60 * 60 * 1000; // 2 hours of inactivity

function maybeSweep(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefillAt > STALE_BUCKET_MS) {
      buckets.delete(key);
    }
  }
  lastSweepAt = now;
}

function checkBucket(key: string, limit: Limit, now: number): RateLimitResult {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: limit.capacity, lastRefillAt: now };
    buckets.set(key, bucket);
  }

  // Refill: add tokens proportional to time elapsed since last refill.
  const elapsed = now - bucket.lastRefillAt;
  const refillRate = limit.capacity / limit.windowMs; // tokens per ms
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

  // Empty bucket — compute when next token will be available.
  const msPerToken = limit.windowMs / limit.capacity;
  const retryAfterMs = Math.ceil(msPerToken - elapsed);
  return {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  };
}

/**
 * Rate-limit a request by both session and IP. Both limits must pass.
 *
 * Returns the first limit that fails (session checked first so legit users
 * with shared NAT addresses still get session-level fairness).
 */
export function checkRateLimits(opts: {
  sessionId: string | null;
  ip: string | null;
  /** Per-session limit, e.g. {capacity: 10, windowMs: 3_600_000} for 10/hr */
  sessionLimit: Limit;
  /** Per-IP limit, e.g. {capacity: 30, windowMs: 3_600_000} for 30/hr */
  ipLimit: Limit;
}): RateLimitResult {
  const now = Date.now();
  maybeSweep(now);

  if (opts.sessionId) {
    const result = checkBucket(`s:${opts.sessionId}`, opts.sessionLimit, now);
    if (!result.allowed) return { ...result, exceeded: 'session' };
  }

  if (opts.ip) {
    const result = checkBucket(`i:${opts.ip}`, opts.ipLimit, now);
    if (!result.allowed) return { ...result, exceeded: 'ip' };
  }

  return { allowed: true, remaining: opts.sessionLimit.capacity, retryAfterSeconds: 0 };
}

/** Test helper — clears all in-memory buckets. */
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
