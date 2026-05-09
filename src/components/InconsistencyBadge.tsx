interface Props {
  variant: 'track_record' | 'inconsistency';
  message: string;
}

/**
 * Visual flag shown on a stance to surface either:
 *   track_record — green ✓ "Voted YES on H.R.5 in 2024"
 *   inconsistency — amber ⚠ "Top donor industry contradicts climate stance"
 *
 * Used inside CandidateDetail (full record view). On the scorecard the
 * smaller pill version is rendered inline by CandidateScorecard.
 */
export function InconsistencyBadge({ variant, message }: Props) {
  if (variant === 'track_record') {
    return (
      <div className="bg-emerald-50 rounded-lg p-3 mb-3">
        <p className="text-xs font-bold text-emerald-800 mb-1">
          ✓ TRACK RECORD
        </p>
        <p className="text-sm text-emerald-900">{message}</p>
      </div>
    );
  }

  return (
    <div className="bg-amber-50 rounded-lg p-3 mb-3">
      <p className="text-xs font-bold text-amber-800 mb-1">
        ⚠ INCONSISTENCY FLAGGED
      </p>
      <p className="text-sm text-amber-900">{message}</p>
    </div>
  );
}

/**
 * Heuristic to classify a track_record_note string into the right badge.
 * Notes from synthesis are tagged: ✓ for alignment, ⚠ for contradiction.
 */
export function classifyTrackRecord(note: string): 'track_record' | 'inconsistency' {
  if (note.startsWith('⚠')) return 'inconsistency';
  if (note.startsWith('✓')) return 'track_record';
  if (/contradict|donor|funded by|inconsistent/i.test(note)) return 'inconsistency';
  return 'track_record';
}
