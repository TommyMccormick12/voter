// Pure helpers for src/app/api/og/route.tsx, pulled out so they're unit-
// testable without invoking Satori/ImageResponse (which needs a real
// rendering runtime, not jsdom). Keeping these out of route.tsx also keeps
// that file's exports to just GET/runtime — Next's route-export checking
// only expects HTTP-method handlers and route config there.

import { PARTY_PALETTE, PARTY_LABEL, resolvePartyKey } from '@/lib/tokens';

export interface OgPartyPalette {
  /** Hero strip gradient (left band) */
  bandFrom: string;
  bandTo: string;
  /** Accent text color */
  accent: string;
  /** Avatar gradient */
  avatarFrom: string;
  avatarTo: string;
  label: string;
}

/** T18 (Spec D1): same PARTY_PALETTE/PARTY_LABEL constants party-theme.ts
 * uses — no hand-duplicated hex in the OG route. */
export function pickOgParty(primaryParty: string | null | undefined): OgPartyPalette {
  const ramp = PARTY_PALETTE[resolvePartyKey(primaryParty)];
  return {
    bandFrom: ramp[50],
    bandTo: ramp[200],
    accent: ramp[800],
    avatarFrom: ramp[400],
    avatarTo: ramp[600],
    label: PARTY_LABEL[resolvePartyKey(primaryParty)],
  };
}

export function ogInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');
}

/** Clamps the `s` (match score) query param to a valid 0-100 integer, or
 * null when absent/unparseable — never NaN/negative/over-100 into the
 * rendered image. */
export function clampOgScore(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}
