// Shared Badge primitive (T18, Spec D1). Two families:
//   - status tones (success/warning/error/info/neutral) — frontend-standards
//     requires these named tokens for any status signal, never raw color
//     alone. Every status badge also carries a text label, so color is
//     never the only signal.
//   - party tone — solid R/D/I fill for party-identity pills (scorecard
//     hero, candidate detail header). Reads PARTY_PALETTE via Tailwind's
//     party-* utilities (globals.css @theme), not hand-typed hex.

import type { ReactNode } from 'react';
import type { PartyKey, StatusKey } from '@/lib/tokens';

type Tone = StatusKey | 'party';

interface Props {
  tone: Tone;
  /** Required when tone === 'party'. */
  partyKey?: PartyKey;
  children: ReactNode;
  className?: string;
}

const STATUS_CLASSES: Record<StatusKey, string> = {
  success: 'bg-status-success/10 text-status-success',
  warning: 'bg-status-warning/10 text-status-warning',
  error: 'bg-status-error/10 text-status-error',
  info: 'bg-status-info/10 text-status-info',
  neutral: 'bg-gray-100 text-gray-700',
};

const PARTY_CLASSES: Record<PartyKey, string> = {
  R: 'bg-party-r-600 text-white',
  D: 'bg-party-d-600 text-white',
  I: 'bg-party-i-600 text-white',
};

export function Badge({ tone, partyKey, children, className = '' }: Props) {
  const toneClasses =
    tone === 'party' && partyKey ? PARTY_CLASSES[partyKey] : STATUS_CLASSES[tone as StatusKey];
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-pill whitespace-nowrap ${toneClasses ?? STATUS_CLASSES.neutral} ${className}`}
    >
      {children}
    </span>
  );
}
