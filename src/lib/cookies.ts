// Cookie helpers — typed wrappers over Next.js cookies() API.
// All cookies are first-party. No third-party trackers anywhere.
// See plan §14.1 for the full inventory and rationale.
//
// SERVER-ONLY: this module imports next/headers which is RSC/route-handler
// only. Do not import from client components — use lib/consent-client.ts
// for client-side cookie reads.

import 'server-only';
import { cookies } from 'next/headers';
import type { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies';

export const COOKIE_NAMES = {
  /** Server-readable session token, replaces Phase 1 localStorage token */
  session: 'voter_session',
  /** JSON: {analytics, data_sale, marketing, version, recorded_at} */
  consent: 'voter_consent',
  /** Stable visitor ID for return-visit detection (set after analytics opt-in) */
  visitor: 'voter_visitor_id',
  /** First-touch attribution (utm_source, utm_medium, utm_campaign, referrer) */
  utm: 'voter_utm',
  /** Cached zip for race-picker quick-load */
  zip: 'voter_zip',
} as const;

const ONE_YEAR = 60 * 60 * 24 * 365;
const TWO_YEARS = ONE_YEAR * 2;
const NINETY_DAYS = 60 * 60 * 24 * 90;
const THIRTY_DAYS = 60 * 60 * 24 * 30;

const BASE_OPTIONS: Partial<ResponseCookie> = {
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};

/** Default options for each cookie. HttpOnly + maxAge tuned per cookie. */
export const COOKIE_OPTIONS = {
  session: { ...BASE_OPTIONS, httpOnly: true, maxAge: ONE_YEAR },
  /** consent must be readable client-side so the banner knows whether to show */
  consent: { ...BASE_OPTIONS, httpOnly: false, maxAge: ONE_YEAR },
  visitor: { ...BASE_OPTIONS, httpOnly: true, maxAge: TWO_YEARS },
  utm: { ...BASE_OPTIONS, httpOnly: true, maxAge: NINETY_DAYS },
  zip: { ...BASE_OPTIONS, httpOnly: true, maxAge: THIRTY_DAYS },
} as const satisfies Record<keyof typeof COOKIE_NAMES, Partial<ResponseCookie>>;

// ============================================================
// Server-side helpers (RSC + route handlers)
// ============================================================

export async function readCookie(name: string): Promise<string | undefined> {
  const store = await cookies();
  return store.get(name)?.value;
}

export async function writeCookie(
  name: keyof typeof COOKIE_NAMES,
  value: string
): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAMES[name], value, COOKIE_OPTIONS[name]);
}

export async function deleteCookie(
  name: keyof typeof COOKIE_NAMES
): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAMES[name]);
}

// ============================================================
// Token generation
// ============================================================

export function generateSessionToken(): string {
  // Crypto-random 64-char hex. Same entropy budget as Phase 1.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateVisitorId(): string {
  // Visitor ID is shorter than session token; intent is "stable across
  // multiple sessions" not "unguessable for the duration of one session".
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
