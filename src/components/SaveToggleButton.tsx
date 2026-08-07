'use client';

// Shared "Save" toggle — fires the same candidate_interactions
// saved/unsaved row from every surface that offers it (the scorecard
// carousel and, per T20/Spec D3, the candidate detail action bar).
// Presentation stays with the caller (className) since the scorecard and
// the detail page style it differently; this module owns only the
// save/unsave behavior.

import { useState } from 'react';
import { trackInteraction } from '@/lib/interactions-client';

interface Props {
  candidateId: string;
  raceId: string;
  viewOrder?: number;
  initialSaved?: boolean;
  onSaved?: (saved: boolean) => void;
  /** Always-applied classes (layout/sizing — shared by both states). */
  className?: string;
  /** Classes applied only while saved — lets each caller supply its own
   * (possibly party-themed) "active" look. Mutually exclusive with
   * `inactiveClassName`. */
  activeClassName?: string;
  /** Classes applied only while not saved. Mutually exclusive with
   * `activeClassName`. */
  inactiveClassName?: string;
  savedLabel?: string;
  unsavedLabel?: string;
}

export function SaveToggleButton({
  candidateId,
  raceId,
  viewOrder,
  initialSaved = false,
  onSaved,
  className = '',
  activeClassName = '',
  inactiveClassName = '',
  savedLabel = '★ Saved',
  unsavedLabel = '★ Save',
}: Props) {
  const [saved, setSaved] = useState(initialSaved);

  const handleSave = () => {
    const next = !saved;
    setSaved(next);
    onSaved?.(next);
    void trackInteraction({
      candidate_id: candidateId,
      race_id: raceId,
      action: next ? 'saved' : 'unsaved',
      view_order: viewOrder ?? null,
    });
  };

  return (
    <button
      type="button"
      onClick={handleSave}
      aria-pressed={saved}
      aria-label={saved ? 'Unsave candidate' : 'Save candidate'}
      className={`${className} ${saved ? activeClassName : inactiveClassName}`.trim()}
    >
      {saved ? savedLabel : unsavedLabel}
    </button>
  );
}
