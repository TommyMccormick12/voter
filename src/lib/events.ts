import { supabase } from './supabase';
import { getSessionId } from './session';
import type { EventType } from '@/types/database';

export async function trackEvent(
  eventType: EventType,
  options?: {
    candidateId?: string;
    issueId?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const sessionId = await getSessionId();
  if (!sessionId) return;

  const { error } = await supabase.from('engagement_events').insert({
    session_id: sessionId,
    event_type: eventType,
    candidate_id: options?.candidateId ?? null,
    issue_id: options?.issueId ?? null,
    metadata: options?.metadata ?? {},
  });

  if (error) {
    console.error('Failed to track event:', error.message);
  }
}
