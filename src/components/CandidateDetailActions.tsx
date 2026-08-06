'use client';

// Save + Share action bar for /candidate/[slug] (T20, Spec D3). Both
// controls were previously inert placeholders. Save reuses the same
// candidate_interactions saved/unsaved toggle as the scorecard; Share
// hands off to the existing /share flow (Spec: "Share → existing share
// flow, or remove — no dead controls").

import { Button } from './ui/Button';
import { SaveToggleButton } from './SaveToggleButton';

interface Props {
  candidateId: string;
  candidateSlug: string;
  raceId: string | null;
}

// Matches Button's own ghost/md sizing so the Save toggle (a plain <button>,
// not the Button primitive — it needs internal toggle state Button doesn't
// have) lines up visually with the adjacent Share button.
const SAVE_CLASS =
  'inline-flex items-center justify-center text-sm font-medium min-h-[44px] px-5 rounded-control transition text-gray-600 hover:bg-gray-100';

export function CandidateDetailActions({ candidateId, candidateSlug, raceId }: Props) {
  return (
    <div className="flex items-center gap-2">
      {raceId && (
        <SaveToggleButton
          candidateId={candidateId}
          raceId={raceId}
          className={SAVE_CLASS}
          activeClassName="text-blue-700 bg-blue-50"
        />
      )}
      {raceId && (
        <Button
          href={`/share?race=${encodeURIComponent(raceId)}&c=${encodeURIComponent(candidateSlug)}`}
          variant="ghost"
          aria-label="Share this candidate"
        >
          Share
        </Button>
      )}
    </div>
  );
}
