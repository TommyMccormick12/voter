// Coarse geo derivation from request headers.
// Critical: the raw IP is NEVER stored. We extract country/state at request
// time, then discard. UA is hashed if needed for audit.
//
// Vercel sets x-vercel-ip-country and x-vercel-ip-country-region on every
// request. In dev / non-Vercel hosts these are absent — we degrade gracefully.

import { createHmac } from 'node:crypto';

export interface CoarseGeo {
  country: string | null; // ISO 3166-1 alpha-2 (e.g. 'US')
  region: string | null;  // state/province code (e.g. 'NJ')
}

/**
 * Read coarse geo from request headers. Vercel-aware; works in dev with
 * fallback to null fields.
 */
export function geoFromHeaders(headers: Headers): CoarseGeo {
  const country = headers.get('x-vercel-ip-country')
    ?? headers.get('cf-ipcountry')
    ?? null;
  const region = headers.get('x-vercel-ip-country-region')
    ?? headers.get('cf-region-code')
    ?? null;
  return {
    country: normalize(country),
    region: normalize(region),
  };
}

function normalize(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed.length === 0 || trimmed === 'XX' ? null : trimmed;
}

/**
 * Privacy-preserving identifier hashing.
 *
 * Uses HMAC-SHA-256 keyed on a server-side secret (IP_HASH_SECRET) so the
 * hashes are NOT brute-forceable from a leaked database. A plain SHA-256
 * with a daily date salt is reversible — IPv4 has 2^32 keys, computable in
 * minutes on commodity GPUs, and the daily salt is public-derivable.
 *
 * The daily date is still mixed in so the same IP/UA hashes differently
 * across days (forward privacy ratchet — yesterday's hash can't be matched
 * against today's even with the secret), but irreversibility comes from
 * the HMAC key, not the date.
 *
 * Set IP_HASH_SECRET in production to a 32+ byte random value. Rotate
 * monthly. Never log it. Never return it in responses.
 */

let warnedMissingSecret = false;

function getHashSecret(): string | null {
  const secret = process.env.IP_HASH_SECRET;
  if (secret && secret.length >= 32) return secret;

  // Production: refuse to hash with a weak/missing secret. Returning null
  // means audit rows get null ip_hash — acceptable, since we'd rather have
  // missing data than reversible data. Caller treats null as "not hashed".
  if (process.env.NODE_ENV === 'production') {
    if (!warnedMissingSecret) {
      console.error(
        '[geo] IP_HASH_SECRET missing or too short (need >=32 chars). ' +
          'IP/UA hashes will be null until configured. ' +
          'NEVER use plain SHA-256 with public salts here — the hashes are reversible.',
      );
      warnedMissingSecret = true;
    }
    return null;
  }

  // Dev/test: fall back to a fixed dev secret + warn loudly. This is
  // acceptable in dev because dev databases shouldn't contain real user
  // IPs, but we still want consistent hashing for tests and dev tooling.
  if (!warnedMissingSecret) {
    console.warn(
      '[geo] IP_HASH_SECRET not set — using dev-only fallback. ' +
        'Set IP_HASH_SECRET in .env.local for production-equivalent behavior.',
    );
    warnedMissingSecret = true;
  }
  return 'dev-only-not-for-production-' + 'dev-only-not-for-production-';
}

function hmacWithDailyRotation(input: string): string | null {
  const secret = getHashSecret();
  if (!secret) return null;
  const dailySalt = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return createHmac('sha256', secret).update(`${dailySalt}::${input}`).digest('hex');
}

/**
 * Hash the user-agent string. HMAC-SHA-256 keyed on IP_HASH_SECRET, with
 * a daily date mixed in for forward rotation. Hashes are de-dup-comparable
 * within a single day but not across days, and not reversible without the
 * secret.
 */
export function hashUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  return hmacWithDailyRotation(ua);
}

/**
 * Hash the client IP. Same scheme as hashUserAgent. Stored only in audit
 * log entries; the raw IP is never persisted.
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return hmacWithDailyRotation(ip);
}


/**
 * Best-effort client IP extraction. Returns null when no proxy header is present.
 * Used at the API route boundary; the IP itself is hashed and discarded —
 * never stored raw.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  // Common proxy header order
  const candidates = [
    headers.get('x-vercel-forwarded-for'),
    headers.get('x-forwarded-for'),
    headers.get('cf-connecting-ip'),
    headers.get('x-real-ip'),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    // x-forwarded-for can be a comma-separated list; first is closest to client
    const first = candidate.split(',')[0]?.trim();
    if (first) return first;
  }
  return null;
}

/** Coarse device-type detection from UA. Browser family only — never version. */
export function deviceTypeFromUa(ua: string | null | undefined): 'mobile' | 'tablet' | 'desktop' {
  if (!ua) return 'desktop';
  const u = ua.toLowerCase();
  if (/(ipad|tablet|playbook|silk)/.test(u)) return 'tablet';
  if (/(mobile|iphone|android.*mobile|webos|iemobile|opera mini)/.test(u)) return 'mobile';
  return 'desktop';
}

export function browserFamilyFromUa(ua: string | null | undefined): string {
  if (!ua) return 'unknown';
  const u = ua.toLowerCase();
  if (u.includes('edg/')) return 'edge';
  if (u.includes('chrome/') && !u.includes('edg/')) return 'chrome';
  if (u.includes('safari/') && !u.includes('chrome/')) return 'safari';
  if (u.includes('firefox/')) return 'firefox';
  if (u.includes('opera/') || u.includes('opr/')) return 'opera';
  return 'other';
}
