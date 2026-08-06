// Unit tests for src/lib/llm/match.ts — matchCandidates heuristic/mock
// path, kill switches, and Zod-validated Haiku parsing (T23,
// SPEC-2026-08-06.md E3).
//
// matchCandidates keeps an in-memory (free_text_hash, race_id) cache at
// module scope, so each test either uses vi.resetModules() + a fresh
// dynamic import (clears the cache) or a unique race_id, to avoid one
// test's cached result leaking into the next.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { CandidateWithFullData } from '@/types/database';
import type { MatchInput } from '@/lib/llm/match';

const { messagesCreateMock } = vi.hoisted(() => ({
  messagesCreateMock: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return { messages: { create: messagesCreateMock } };
  }),
}));

const ORIGINAL_ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ORIGINAL_DISABLED = process.env.MATCH_API_DISABLED;

function haikuTextResponse(json: unknown, tokens = { input_tokens: 10, output_tokens: 5 }) {
  return {
    content: [{ type: 'text', text: JSON.stringify(json) }],
    usage: tokens,
  };
}

const candidates: CandidateWithFullData[] = [
  {
    id: 'cand-1',
    name: 'Test Candidate',
    slug: 'test-candidate',
    party: 'D',
    state: 'FL',
    district: '01',
    race_id: 'race-1',
    office: 'U.S. House',
    photo_url: null,
    bio: null,
    website: null,
    active: true,
    primary_party: 'D',
    incumbent: false,
    total_raised: null,
    top_stances: [
      {
        stance_id: 'test-candidate-economy',
        issue_slug: 'economy',
        stance: 'support',
        summary: 'Supports economic growth policies.',
        source_url: '',
        confidence: 70,
      },
    ],
  },
];

function baseInput(raceId: string): MatchInput {
  return {
    free_text: 'I care about the economy.',
    race_id: raceId,
    candidates,
  };
}

describe('matchCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MATCH_API_DISABLED;
  });

  afterAll(() => {
    if (ORIGINAL_ANTHROPIC_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_KEY;
    if (ORIGINAL_DISABLED === undefined) delete process.env.MATCH_API_DISABLED;
    else process.env.MATCH_API_DISABLED = ORIGINAL_DISABLED;
  });

  describe('mock heuristic path — deterministic ranking', () => {
    it('ranks candidates deterministically given fixed quick-poll weights and stances', async () => {
      const { __test } = await import('@/lib/llm/match');

      const twoCandidates = [
        {
          id: 'cand-a',
          top_stances: [
            { stance_id: 'a-climate', issue_slug: 'climate', stance: 'strongly_support', summary: '', source_url: '', confidence: 90 },
            { stance_id: 'a-guns', issue_slug: 'guns', stance: 'oppose', summary: '', source_url: '', confidence: 60 },
          ],
        },
        {
          id: 'cand-b',
          top_stances: [
            { stance_id: 'b-guns', issue_slug: 'guns', stance: 'strongly_support', summary: '', source_url: '', confidence: 80 },
            { stance_id: 'b-immigration', issue_slug: 'immigration', stance: 'strongly_oppose', summary: '', source_url: '', confidence: 75 },
          ],
        },
      ] as unknown as CandidateWithFullData[];

      const input: MatchInput = {
        free_text: 'I want a leader who listens.',
        race_id: 'race-deterministic',
        candidates: twoCandidates,
        quick_poll: [
          { issue_slug: 'climate', weight: 5 },
          { issue_slug: 'guns', weight: 2 },
        ],
      };

      const ranked = __test.mockRank(input);

      // Candidate A: climate (5*1=5) + guns oppose (2*0.5=1) = 6/7 -> 86%
      // Candidate B: guns strongly_support (2*1=2), immigration unweighted (ignored) = 2/7 -> 29%
      expect(ranked).toEqual([
        {
          candidate_id: 'cand-a',
          score: 86,
          matched_stances: ['a-climate', 'a-guns'],
          rationale: 'Closest alignment on climate, guns.',
        },
        {
          candidate_id: 'cand-b',
          score: 29,
          matched_stances: ['b-guns'],
          rationale: 'Closest alignment on guns.',
        },
      ]);

      // Deterministic: same input, same output, called again.
      expect(__test.mockRank(input)).toEqual(ranked);
    });
  });

  describe('source meta on the fallback path', () => {
    it('always sets source:"mock" when no API key is configured, on first call and cache hit', async () => {
      const { matchCandidates } = await import('@/lib/llm/match');
      const input = baseInput('race-mock-source');

      const first = await matchCandidates(input);
      expect(first.source).toBe('mock');
      expect(first.cache_hit).toBe(false);

      const second = await matchCandidates(input);
      expect(second.source).toBe('mock'); // must survive the cache hit
      expect(second.cache_hit).toBe(true);
    });
  });

  describe('kill switch / no-key behavior', () => {
    it('falls back to mock when ANTHROPIC_API_KEY is missing, never calling Anthropic', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const { matchCandidates } = await import('@/lib/llm/match');
      const result = await matchCandidates(baseInput('race-no-key'));
      expect(result.source).toBe('mock');
      expect(messagesCreateMock).not.toHaveBeenCalled();
    });

    it('falls back to mock when MATCH_API_DISABLED=true, even with a key present', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.MATCH_API_DISABLED = 'true';
      const { matchCandidates } = await import('@/lib/llm/match');
      const result = await matchCandidates(baseInput('race-kill-switch'));
      expect(result.source).toBe('mock');
      expect(messagesCreateMock).not.toHaveBeenCalled();
    });
  });

  describe('Zod validation of Haiku responses', () => {
    it('calls Haiku and returns source:"haiku" when the response is well-formed', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      messagesCreateMock.mockResolvedValue(
        haikuTextResponse(
          {
            ranked: [
              {
                candidate_id: 'cand-1',
                score: 80,
                matched_stances: ['test-candidate-economy'],
                rationale: 'Closest alignment on economy.',
              },
            ],
          },
          { input_tokens: 120, output_tokens: 45 },
        ),
      );
      const { matchCandidates } = await import('@/lib/llm/match');
      const result = await matchCandidates(baseInput('race-haiku-happy'));
      expect(result.source).toBe('haiku');
      expect(result.input_tokens).toBe(120);
      expect(result.output_tokens).toBe(45);
      expect(result.ranked[0].score).toBe(80);
    });

    it('falls back to mock when the Haiku response fails Zod schema validation', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      messagesCreateMock.mockResolvedValue(
        // Missing required fields (score, matched_stances, rationale).
        haikuTextResponse({ ranked: [{ candidate_id: 'cand-1' }] }),
      );
      const { matchCandidates } = await import('@/lib/llm/match');
      const result = await matchCandidates(baseInput('race-haiku-malformed'));
      expect(result.source).toBe('mock');
    });

    it('falls back to mock when Haiku references a stance_id not in the input set', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      messagesCreateMock.mockResolvedValue(
        haikuTextResponse({
          ranked: [
            {
              candidate_id: 'cand-1',
              score: 80,
              matched_stances: ['does-not-exist'],
              rationale: 'fabricated',
            },
          ],
        }),
      );
      const { matchCandidates } = await import('@/lib/llm/match');
      const result = await matchCandidates(baseInput('race-haiku-fabricated-stance'));
      expect(result.source).toBe('mock');
    });

    it('falls back to mock when the Haiku response has no parseable JSON', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      messagesCreateMock.mockResolvedValue({
        content: [{ type: 'text', text: 'Sorry, I cannot help with that.' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
      const { matchCandidates } = await import('@/lib/llm/match');
      const result = await matchCandidates(baseInput('race-haiku-no-json'));
      expect(result.source).toBe('mock');
    });
  });
});
