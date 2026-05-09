// Client-side interaction tracker.
// Fires POST /api/interaction. Fire-and-forget; errors logged not thrown.
//
// In Phase 2A this is a no-op stub; the API route is built in Chunk 3.

import type { InteractionAction } from '@/types/database';

interface TrackInput {
  candidate_id: string;
  race_id: string;
  action: InteractionAction;
  view_order?: number | null;
  dwell_ms?: number | null;
}

export async function trackInteraction(input: TrackInput): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await fetch('/api/interaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      keepalive: true, // ensures dispatch survives page transitions
    });
  } catch (err) {
    // Swallow — analytics failure must never break user flow
    console.warn('[interaction] dispatch failed', err);
  }
}
