import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveRankings, getAggregateByZip, getPercentile } from '@/lib/rankings';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => {
  const mockChain = {
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'mock-session-id' }, error: null }),
    order: vi.fn().mockReturnThis(),
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

vi.mock('@/lib/events', () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

describe('rankings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('saveRankings', () => {
    it('returns error for empty array', async () => {
      const result = await saveRankings([]);
      expect(result.success).toBe(false);
      expect(result.error).toBe('No issues to save');
    });

    it('returns error when no session', async () => {
      const { getSessionId } = await import('@/lib/session');
      vi.mocked(getSessionId).mockResolvedValueOnce(null);
      const result = await saveRankings(['issue-1']);
      expect(result.success).toBe(false);
      expect(result.error).toBe('No active session');
    });

    it('inserts rows with correct rank order', async () => {
      const result = await saveRankings(['a', 'b', 'c']);
      expect(result.success).toBe(true);
      expect(supabase.from).toHaveBeenCalledWith('issue_rankings');
    });

    it('tracks ranking_completed event on success', async () => {
      const { trackEvent } = await import('@/lib/events');
      await saveRankings(['a', 'b', 'c']);
      expect(trackEvent).toHaveBeenCalledWith('ranking_completed', {
        metadata: { issue_count: 3 },
      });
    });

    it('returns error on insert failure', async () => {
      const { __mockChain } = await import('@/lib/supabase') as { __mockChain: { insert: ReturnType<typeof vi.fn> } };
      __mockChain.insert.mockResolvedValueOnce({
        data: null,
        error: { message: 'DB error' },
      });
      const result = await saveRankings(['a']);
      expect(result.success).toBe(false);
    });
  });

  describe('getAggregateByZip', () => {
    it('returns empty array on error', async () => {
      const { __mockChain } = await import('@/lib/supabase') as { __mockChain: { eq: ReturnType<typeof vi.fn> } };
      __mockChain.eq.mockResolvedValueOnce({ data: null, error: { message: 'fail' } });
      const result = await getAggregateByZip('90210');
      expect(result).toEqual([]);
    });

    it('returns empty array when below minimum threshold', async () => {
      const { __mockChain } = await import('@/lib/supabase') as { __mockChain: { eq: ReturnType<typeof vi.fn> } };
      __mockChain.eq.mockResolvedValueOnce({
        data: Array(5).fill({ issue_id: 'a', rank: 1, sessions: { zip_code: '90210' }, issues: { name: 'Test' } }),
        error: null,
      });
      const result = await getAggregateByZip('90210');
      expect(result).toEqual([]);
    });

    it('aggregates and sorts by avg_rank', async () => {
      const rows = [
        ...Array(6).fill(null).map(() => ({ issue_id: 'a', rank: 1, sessions: { zip_code: '90210' }, issues: { name: 'Economy' } })),
        ...Array(6).fill(null).map(() => ({ issue_id: 'b', rank: 3, sessions: { zip_code: '90210' }, issues: { name: 'Healthcare' } })),
      ];
      const { __mockChain } = await import('@/lib/supabase') as { __mockChain: { eq: ReturnType<typeof vi.fn> } };
      __mockChain.eq.mockResolvedValueOnce({ data: rows, error: null });
      const result = await getAggregateByZip('90210');
      expect(result[0].issue_name).toBe('Economy');
      expect(result[0].avg_rank).toBe(1);
      expect(result[1].issue_name).toBe('Healthcare');
      expect(result[1].avg_rank).toBe(3);
    });
  });

  describe('getPercentile', () => {
    it('returns baseline percentiles when no community data', async () => {
      const { __mockChain } = await import('@/lib/supabase') as { __mockChain: { eq: ReturnType<typeof vi.fn> } };
      __mockChain.eq.mockResolvedValueOnce({ data: [], error: null });
      __mockChain.eq.mockResolvedValueOnce({
        data: [
          { issue_slug: 'economy', avg_rank: 1.5, response_pct: 72 },
          { issue_slug: 'healthcare', avg_rank: 2.1, response_pct: 65 },
        ],
        error: null,
      });
      const result = await getPercentile(
        [
          { id: 'id-1', slug: 'economy' },
          { id: 'id-2', slug: 'healthcare' },
        ],
        '90210'
      );
      expect(result).toHaveLength(2);
      expect(result[0].percentile).toBe(72);
      expect(result[1].percentile).toBe(65);
    });

    it('defaults to 50 when no baseline found for slug', async () => {
      const { __mockChain } = await import('@/lib/supabase') as { __mockChain: { eq: ReturnType<typeof vi.fn> } };
      __mockChain.eq.mockResolvedValueOnce({ data: [], error: null });
      __mockChain.eq.mockResolvedValueOnce({ data: [], error: null });
      const result = await getPercentile(
        [{ id: 'id-1', slug: 'unknown_issue' }],
        '00000'
      );
      expect(result[0].percentile).toBe(50);
    });

    it('returns correct user_rank ordering', async () => {
      const { __mockChain } = await import('@/lib/supabase') as { __mockChain: { eq: ReturnType<typeof vi.fn> } };
      __mockChain.eq.mockResolvedValueOnce({ data: [], error: null });
      __mockChain.eq.mockResolvedValueOnce({ data: [], error: null });
      const result = await getPercentile(
        [
          { id: '1', slug: 'a' },
          { id: '2', slug: 'b' },
          { id: '3', slug: 'c' },
        ],
        '12345'
      );
      expect(result[0].user_rank).toBe(1);
      expect(result[1].user_rank).toBe(2);
      expect(result[2].user_rank).toBe(3);
    });
  });
});
