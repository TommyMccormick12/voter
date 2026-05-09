// First-party analytics dispatcher. Gated on consent_analytics.
//
// All events go to /api/* endpoints on our own domain. Zero third-party
// pixels, zero ad-network beacons, zero browser fingerprinting. If
// consent_analytics is false, dispatch is a no-op.
//
// Why first-party only:
//   1. Third-party cookies are dead in Chrome (2024+), Safari ITP (2017+),
//      Firefox ETP — they would just silently fail
//   2. Our audience runs ad blockers at 25-40% — third-party endpoints get
//      stripped before they fire
//   3. Reputational cost of "civic tool sold voter data" >> incremental data
//      value of cross-site tracking
//
// See plan §14.2 for the consent tier breakdown.

'use client';

import { readClientConsent } from './consent-client';

interface InteractionInput {
  candidate_id: string;
  race_id: string;
  action: string;
  view_order?: number | null;
  dwell_ms?: number | null;
}

/**
 * Dispatch a candidate-interaction event. Consent-gated: silently no-ops
 * when consent_analytics is false.
 *
 * Note: we still dispatch on functional pages where the user hasn't yet
 * consented — but the API route checks consent and drops the row. This
 * preserves the "always works" UX while honoring the consent state on the
 * server. Same logic mirrored client-side here as a fast-path: skip the
 * fetch entirely if we already know consent is denied.
 */
export async function trackInteraction(input: InteractionInput): Promise<void> {
  if (typeof window === 'undefined') return;

  const consent = readClientConsent();
  if (consent && consent.analytics === false) {
    // User explicitly opted out — don't even hit the API
    return;
  }
  // If consent is null, the user hasn't seen the banner yet. We let the
  // request through; the API route will drop it server-side once the user
  // makes a choice. This avoids losing first-page-view data.

  try {
    await fetch('/api/interaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      keepalive: true,
    });
  } catch (err) {
    console.warn('[analytics] interaction dispatch failed', err);
  }
}

/**
 * Page-view event. Fired from the root layout's client wrapper.
 * Consent-gated identically to interactions.
 */
export async function trackPageView(path: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const consent = readClientConsent();
  if (consent && consent.analytics === false) return;
  try {
    await fetch('/api/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
      keepalive: true,
    });
  } catch (err) {
    console.warn('[analytics] page-view dispatch failed', err);
  }
}
