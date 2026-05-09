// Coarse geo derivation from request headers.
// Critical: the raw IP is NEVER stored. We extract country/state at request
// time, then discard. UA is hashed if needed for audit.
//
// Vercel sets x-vercel-ip-country and x-vercel-ip-country-region on every
// request. In dev / non-Vercel hosts these are absent — we degrade gracefully.

import { createHash } from 'node:crypto';

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
 * Hash the user-agent string with a daily salt. Stored hashes can be
 * compared within a day (de-dupe) but not across days (privacy ratchet).
 */
export function hashUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const dailySalt = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return createHash('sha256').update(`${dailySalt}::${ua}`).digest('hex');
}

/**
 * Hash the client IP with a daily salt. Same privacy properties as UA hash.
 * Used only for audit log entries; never stored alongside other PII.
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const dailySalt = new Date().toISOString().slice(0, 10);
  return createHash('sha256').update(`${dailySalt}::${ip}`).digest('hex');
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
