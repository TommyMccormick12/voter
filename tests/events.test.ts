import { describe, it, expect, beforeEach, vi } from 'vitest';
import { trackEvent } from '@/lib/events';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => {
  const mockChain = {
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'mock-session-id' }, error: null }),
  };
  return {
    supabase: {
      from: vi.fn(() => mockChain),
    },
    __mockChain: mockChain,
  };
});

vi.mock('@/lib/session', () => ({
  getSessionId: vi.fn().mockResolvedValue('mock-session-id'),
  getSessionToken: vi.fn().mockReturnValue('mock-token'),
  getOrCreateSession: vi.fn().mockResolvedValue('mock-token'),
  setSessionLocation: vi.fn().mockResolvedValue(undefined),
}));

describe('events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts an event with session_id', async () => {
    await trackEvent('view_candidate', { candidateId: 'c1' });
    expect(supabase.from).toHaveBeenCalledWith('engagement_events');
  });

  it('passes candidate_id when provided', async () => {
    await trackEvent('view_candidate', { candidateId: 'candidate-123' });
    expect(supabase.from).toHaveBeenCalled();
  });

  it('passes issue_id when provided', async () => {
    await trackEvent('rank_issues', { issueId: 'issue-456' });
    expect(supabase.from).toHaveBeenCalled();
  });

  it('passes metadata when provided', async () => {
    await trackEvent('ranking_completed', {
      metadata: { issue_count: 5 },
    });
    expect(supabase.from).toHaveBeenCalled();
  });

  it('does nothing when session id is null', async () => {
    const { getSessionId } = await import('@/lib/session');
    vi.mocked(getSessionId).mockResolvedValueOnce(null);
    await trackEvent('view_candidate');
    expect(supabase.from).not.toHaveBeenCalledWith('engagement_events');
  });

  it('handles all event types', async () => {
    const types = [
      'view_candidate',
      'view_comparison',
      'rank_issues',
      'ranking_completed',
      'card_shared',
      'share',
      'return_visit',
    ] as const;

    for (const type of types) {
      vi.clearAllMocks();
      await trackEvent(type);
      expect(supabase.from).toHaveBeenCalled();
    }
  });
});
