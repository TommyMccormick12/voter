// Client-side consent helpers. Reads document.cookie directly so no
// server-only imports leak into the client bundle.

import type { ConsentState } from '@/types/database';
import { CURRENT_CONSENT_VERSION } from './consent-shared';

const CONSENT_COOKIE = 'voter_consent';

/**
 * Read consent state from document.cookie. Returns null if missing or
 * malformed. Mirrors the server-side parseConsent logic.
 */
export function readClientConsent(): ConsentState | null {
  if (typeof document === 'undefined') return null;
  const row = document.cookie
    .split('; ')
    .find((r) => r.startsWith(`${CONSENT_COOKIE}=`));
  if (!row) return null;
  const raw = row.slice(CONSENT_COOKIE.length + 1);
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    const data = JSON.parse(decoded) as Partial<ConsentState>;
    if (typeof data !== 'object' || data === null) return null;
    if (data.version !== CURRENT_CONSENT_VERSION) return null;
    return {
      analytics: Boolean(data.analytics),
      data_sale: Boolean(data.data_sale),
      marketing: Boolean(data.marketing),
      functional: true,
      version: CURRENT_CONSENT_VERSION,
      recorded_at: typeof data.recorded_at === 'string'
        ? data.recorded_at
        : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
