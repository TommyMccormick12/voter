// Design tokens — single source of truth for palette, radii, and spacing
// (Spec D1 / T18). Evolves the existing identity (R=red / D=blue / I=violet,
// Decision 11) — these are the same hex values Tailwind's stock red/blue/
// violet scales already used across the app, just named and centralized.
//
// Three consumers read from here, and only here:
//   1. Components — src/lib/party-theme.ts imports PARTY_PALETTE and
//      PARTY_LABEL to build its theme map (Tailwind class strings stay as
//      literal `bg-red-600`-style utilities, which is fine: Tailwind's
//      built-in red/blue/violet scales already equal PARTY_PALETTE; the one
//      raw-hex value a component needs directly, `industryFill`, now reads
//      from PARTY_PALETTE instead of a hand-typed hex).
//   2. Tailwind — src/app/globals.css mirrors PARTY_PALETTE, STATUS, and
//      RADII as CSS custom properties inside its `@theme` block, generating
//      `bg-party-r-600`, `text-status-success`, `rounded-card` etc. Tailwind
//      4 reads CSS at build time and cannot import a TS module directly, so
//      the literal values are necessarily copied there.
//      tests/tokens-sync.test.ts parses globals.css and asserts every value
//      matches this module, so the two can never silently drift.
//   3. src/app/api/og/route.tsx — Satori (next/og) renders inline styles,
//      not Tailwind classes, so it imports PARTY_PALETTE and PARTY_LABEL
//      directly. No hand-duplicated hex.

export type PartyKey = 'R' | 'D' | 'I';

export interface ColorRamp {
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
}

export const PARTY_PALETTE: Record<PartyKey, ColorRamp> = {
  R: {
    50: '#fef2f2',
    100: '#fee2e2',
    200: '#fecaca',
    300: '#fca5a5',
    400: '#f87171',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
    800: '#991b1b',
  },
  D: {
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
    800: '#1e40af',
  },
  I: {
    50: '#f5f3ff',
    100: '#ede9fe',
    200: '#ddd6fe',
    300: '#c4b5fd',
    400: '#a78bfa',
    500: '#8b5cf6',
    600: '#7c3aed',
    700: '#6d28d9',
    800: '#5b21b6',
  },
};

export const PARTY_LABEL: Record<PartyKey, string> = {
  R: 'Republican',
  D: 'Democrat',
  I: 'Independent',
};

/** Status tokens — frontend-standards requires these for any status signal
 * (never raw color alone). Used by the Badge primitive. */
export const STATUS = {
  success: '#059669',
  warning: '#d97706',
  error: '#dc2626',
  info: '#2563eb',
  neutral: '#6b7280',
} as const;

export type StatusKey = keyof typeof STATUS;

/** Radii used by the shared primitives (Button, Card, Badge). Named by
 * role, not by scale step, so a future visual pass can change the value
 * without renaming every call site. */
export const RADII = {
  card: '1rem',
  control: '0.75rem',
  pill: '9999px',
} as const;

/** Resolve any raw `primary_party` string to one of the three theme keys.
 * Shared by party-theme.ts and the OG route so "unknown/blank party falls
 * back to Independent" is defined exactly once. */
export function resolvePartyKey(primaryParty: string | null | undefined): PartyKey {
  if (!primaryParty) return 'I';
  const key = primaryParty.toUpperCase().charAt(0);
  if (key === 'R') return 'R';
  if (key === 'D') return 'D';
  return 'I';
}
