// Server-side consent helpers. Imports cookies.ts which is server-only.
// Client components should import readClientConsent from consent-client.ts.
//
// Per the plan §14.5 and Risks §11:
//   - California (CCPA/CPRA): default data_sale = false
//   - Colorado, Connecticut, Virginia, Utah: political opinions are sensitive
//     data; require explicit opt-in (not opt-out) for sale
//   - Other US states: default data_sale = false until explicit opt-in
//
// Functional consent is always implied (strictly necessary).

import { COOKIE_NAMES, readCookie, writeCookie } from './cookies';
import type { ConsentState } from '@/types/database';
import { CURRENT_CONSENT_VERSION } from './consent-shared';

export { CURRENT_CONSENT_VERSION };

/**
 * State-aware default consent. Used when no consent cookie is set yet.
 * Conservative everywhere: data_sale defaults to false.
 */
export function defaultConsent(state?: string | null): ConsentState {
  const stateUpper = state?.toUpperCase();
  // CO and CT treat political opinions as sensitive — never default-on.
  // CA, VA, UT have opt-out frameworks but for political data we still
  // default-off. All US states therefore start at the same conservative
  // baseline; state matters only for which legal regime governs the opt-in.
  void stateUpper; // reserved for future region-specific tweaks
  return {
    analytics: false,
    data_sale: false,
    marketing: false,
    functional: true,
    version: CURRENT_CONSENT_VERSION,
    recorded_at: new Date().toISOString(),
  };
}

/**
 * Parse the voter_consent cookie value. Returns null if missing or malformed.
 * On version mismatch, returns null so the banner re-prompts.
 *
 * NOTE: Next's cookies().get(name).value returns the AUTO-DECODED string,
 * so this expects raw JSON, not URI-encoded JSON. The client-side reader
 * in consent-client.ts handles its own decoding (document.cookie is raw).
 */
export function parseConsent(raw: string | null | undefined): ConsentState | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<ConsentState>;
    if (typeof data !== 'object' || data === null) return null;
    if (data.version !== CURRENT_CONSENT_VERSION) return null;
    return {
      analytics: Boolean(data.analytics),
      data_sale: Boolean(data.data_sale),
      marketing: Boolean(data.marketing),
      functional: true, // always
      version: CURRENT_CONSENT_VERSION,
      recorded_at: typeof data.recorded_at === 'string'
        ? data.recorded_at
        : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Serialize consent state for the cookie value. Returns raw JSON; Next's
 * cookies().set() handles URI-encoding for transport.
 */
export function serializeConsent(state: ConsentState): string {
  return JSON.stringify(state);
}

/** Server-side: read current consent from cookies. Returns null if no cookie set. */
export async function getServerConsent(): Promise<ConsentState | null> {
  const raw = await readCookie(COOKIE_NAMES.consent);
  return parseConsent(raw);
}

/** Server-side: write a new consent state. */
export async function setServerConsent(state: ConsentState): Promise<void> {
  await writeCookie('consent', serializeConsent(state));
}

// ============================================================
// Convenience helpers for code that only needs to gate behavior
// ============================================================

export function isAnalyticsAllowed(consent: ConsentState | null): boolean {
  return consent?.analytics === true;
}

export function isDataSaleAllowed(consent: ConsentState | null): boolean {
  return consent?.data_sale === true;
}

// Client-side helper lives in consent-client.ts to avoid pulling cookies.ts
// (and its server-only next/headers import) into client bundles.
