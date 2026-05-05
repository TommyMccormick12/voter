import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getOrCreateSession, getSessionId, setSessionLocation, getSessionToken } from '@/lib/session';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => {
  const mockChain = {
    insert: vi.fn().mockReturnThis(),
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

describe('session', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('getOrCreateSession', () => {
    it('creates a new session when none exists', async () => {
      const token = await getOrCreateSession();
      expect(token).toHaveLength(64);
      expect(localStorage.getItem('voter_session_token')).toBe(token);
    });

    it('returns existing token if already stored', async () => {
      localStorage.setItem('voter_session_token', 'existing-token-abc');
      const token = await getOrCreateSession();
      expect(token).toBe('existing-token-abc');
    });

    it('generates a hex token (only 0-9a-f chars)', async () => {
      const token = await getOrCreateSession();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('calls supabase insert for new sessions', async () => {
      await getOrCreateSession();
      expect(supabase.from).toHaveBeenCalledWith('sessions');
    });

    it('calls supabase update for returning sessions', async () => {
      localStorage.setItem('voter_session_token', 'returning-token');
      await getOrCreateSession();
      expect(supabase.from).toHaveBeenCalledWith('sessions');
    });
  });

  describe('getSessionToken', () => {
    it('returns null when no token in localStorage', () => {
      expect(getSessionToken()).toBeNull();
    });

    it('returns the stored token', () => {
      localStorage.setItem('voter_session_token', 'test-token');
      expect(getSessionToken()).toBe('test-token');
    });
  });

  describe('getSessionId', () => {
    it('returns null when no session token exists', async () => {
      // Must test before any getOrCreateSession call populates the cache
      // Re-import a fresh module to avoid cached state
      vi.resetModules();
      vi.mock('@/lib/supabase', () => {
        const chain = {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'mock-session-id' }, error: null }),
        };
        return { supabase: { from: vi.fn(() => chain) } };
      });
      const { getSessionId: freshGetSessionId } = await import('@/lib/session');
      const id = await freshGetSessionId();
      expect(id).toBeNull();
    });

    it('returns cached id after getOrCreateSession', async () => {
      await getOrCreateSession();
      const id = await getSessionId();
      expect(id).toBe('mock-session-id');
    });
  });

  describe('setSessionLocation', () => {
    it('calls supabase update with zip code', async () => {
      await setSessionLocation('test-token', '90210');
      expect(supabase.from).toHaveBeenCalledWith('sessions');
    });
  });
});
