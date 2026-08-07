// Party-color theming utility — maps primary_party to Tailwind class strings.
//
// Usage:
//   const theme = getPartyTheme(candidate.primary_party);
//   <div className={theme.heroBg}>...</div>
//   <button className={theme.accent}>...</button>

import { PARTY_PALETTE, PARTY_LABEL, resolvePartyKey, type PartyKey } from './tokens';

export type { PartyKey };

export interface PartyTheme {
  /** Hero strip gradient background */
  heroBg: string;
  /** Primary CTA / accent button background+text */
  accent: string;
  /** Card border color */
  border: string;
  /** Tinted text color (for "raised", labels) */
  text: string;
  /** Soft tinted background for "Funded by" pill */
  softBg: string;
  /** Avatar gradient class */
  avatarGradient: string;
  /** Tab indicator border (active tab on detail page) */
  tabBorder: string;
  /** Stance left-border color */
  stanceBorder: string;
  /** Industry bar fill color (CSS color value, used inline) */
  industryFill: string;
  /** Display name for the party */
  label: string;
}

const themes: Record<PartyKey, PartyTheme> = {
  R: {
    heroBg: 'bg-gradient-to-br from-red-50 to-red-200',
    accent: 'bg-red-600 text-white hover:bg-red-700',
    border: 'border-red-300',
    text: 'text-red-800',
    softBg: 'bg-red-50',
    avatarGradient: 'bg-gradient-to-br from-red-400 to-red-600',
    tabBorder: 'border-red-600 text-red-800',
    stanceBorder: 'border-red-500',
    industryFill: PARTY_PALETTE.R[600],
    label: PARTY_LABEL.R,
  },
  D: {
    heroBg: 'bg-gradient-to-br from-blue-50 to-blue-200',
    accent: 'bg-blue-600 text-white hover:bg-blue-700',
    border: 'border-blue-300',
    text: 'text-blue-800',
    softBg: 'bg-blue-50',
    avatarGradient: 'bg-gradient-to-br from-blue-400 to-blue-600',
    tabBorder: 'border-blue-600 text-blue-800',
    stanceBorder: 'border-blue-500',
    industryFill: PARTY_PALETTE.D[600],
    label: PARTY_LABEL.D,
  },
  I: {
    heroBg: 'bg-gradient-to-br from-violet-50 to-violet-200',
    accent: 'bg-violet-600 text-white hover:bg-violet-700',
    border: 'border-violet-300',
    text: 'text-violet-800',
    softBg: 'bg-violet-50',
    avatarGradient: 'bg-gradient-to-br from-violet-400 to-violet-600',
    tabBorder: 'border-violet-600 text-violet-800',
    stanceBorder: 'border-violet-500',
    industryFill: PARTY_PALETTE.I[600],
    label: PARTY_LABEL.I,
  },
};

export function getPartyTheme(primaryParty: string | null | undefined): PartyTheme {
  return themes[resolvePartyKey(primaryParty)];
}

export function getPartyInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');
}
