// Match a user's free-text policy preferences against candidate stances
// for a given race.
//
// Two implementation paths:
//   1. ANTHROPIC_API_KEY set: call Claude Haiku 4.5 with prompt caching on
//      the candidate-stances block. Cheapest tier per the locked plan.
//   2. No API key (or MATCH_API_DISABLED=true): deterministic local mock
//      ranking based on quick-poll weights. Lets the UX work end-to-end
//      before keys are configured.
//
// TODO (Chunk 5/6): swap the in-memory cache for a Supabase llm_matches
// table lookup. Add session+IP rate limits via the cookie/middleware layer.

import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  CandidateWithFullData,
  MatchResult,
  Stance,
} from '@/types/database';

// ============================================================
// Public types
// ============================================================

export interface QuickPollWeight {
  issue_slug: string;
  weight: number; // 1-5
}

export interface MatchInput {
  free_text: string;
  race_id: string;
  candidates: CandidateWithFullData[];
  quick_poll?: QuickPollWeight[];
}

export interface MatchResponse {
  ranked: MatchResult[];
  cache_hit: boolean;
  source: 'haiku' | 'mock' | 'cache';
  /** Tokens consumed (real LLM only). 0 for mock + cache. */
  input_tokens?: number;
  output_tokens?: number;
}

// ============================================================
// Cache (in-memory; Chunk 6 swaps for Supabase llm_matches)
// ============================================================

interface CacheEntry {
  ranked: MatchResult[];
  source: 'haiku' | 'mock';
  input_tokens?: number;
  output_tokens?: number;
}

const cache = new Map<string, CacheEntry>();

export function hashFreeText(freeText: string, raceId: string): string {
  return createHash('sha256').update(`${raceId}::${freeText.trim()}`).digest('hex');
}

// ============================================================
// LLM response schema (output discipline)
// ============================================================

const MatchedSchema = z.object({
  candidate_id: z.string(),
  score: z.number().min(0).max(100),
  matched_stances: z.array(z.string()),
  rationale: z.string().max(200),
});

const RankedSchema = z.object({
  ranked: z.array(MatchedSchema).min(1),
});

// ============================================================
// Public API
// ============================================================

const HAIKU_MODEL = 'claude-haiku-4-5';

/**
 * Match a user's free-text + quick-poll preferences against a race's candidates.
 * Returns ranked candidates with match scores.
 */
export async function matchCandidates(input: MatchInput): Promise<MatchResponse> {
  if (input.candidates.length === 0) {
    return { ranked: [], cache_hit: false, source: 'mock' };
  }

  const cacheKey = hashFreeText(input.free_text, input.race_id);
  const cached = cache.get(cacheKey);
  if (cached) {
    return { ...cached, cache_hit: true, source: 'cache' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const disabled = process.env.MATCH_API_DISABLED === 'true';

  let result: CacheEntry;
  if (!apiKey || disabled) {
    result = {
      ranked: mockRank(input),
      source: 'mock',
    };
  } else {
    try {
      result = await callHaiku(input, apiKey);
    } catch (err) {
      console.error('[llm/match] Haiku call failed, falling back to mock:', err);
      result = { ranked: mockRank(input), source: 'mock' };
    }
  }

  cache.set(cacheKey, result);
  return { ...result, cache_hit: false };
}

// ============================================================
// Real LLM path
// ============================================================

async function callHaiku(input: MatchInput, apiKey: string): Promise<CacheEntry> {
  const client = new Anthropic({ apiKey });

  // Build the candidate-stances block. Wrap in cache_control so the same
  // block is reused across users for the same race.
  const stancesBlock = buildStancesBlock(input.candidates);
  const validStanceIds = new Set(
    input.candidates.flatMap((c) => c.top_stances.map((s) => s.stance_id))
  );

  const pollSummary = input.quick_poll && input.quick_poll.length > 0
    ? `\n\nIssue weights from quick poll (1=low, 5=high):\n${input.quick_poll
        .map((q) => `- ${q.issue_slug}: ${q.weight}/5`)
        .join('\n')}`
    : '';

  const userPrompt = `User's free-text statement:\n"${input.free_text.trim()}"${pollSummary}

Rank the candidates from best to worst match. Return JSON: {"ranked": [{candidate_id, score (0-100), matched_stances (stance_ids that drove the match), rationale (max 25 words)}]}.

Rules:
- matched_stances MUST reference stance_ids from the candidate stances above
- score reflects alignment between the user's text/weights and the candidate's stances + track record
- if track_record_note contradicts a stance, lower the score
- never claim "best match" — say "closest alignment"`;

  const message = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: 'You are a candidate matching system. Output VALID JSON ONLY, no preamble. Schema: {ranked: [{candidate_id, score, matched_stances, rationale}]}.',
      },
      {
        type: 'text',
        text: stancesBlock,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  // Extract text content
  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text block in Haiku response');
  }

  // Parse + validate
  const json = extractJson(textBlock.text);
  const parsed = RankedSchema.parse(json);

  // Validate every matched_stance references a real stance_id
  for (const r of parsed.ranked) {
    for (const sid of r.matched_stances) {
      if (!validStanceIds.has(sid)) {
        throw new Error(
          `Haiku referenced unknown stance_id "${sid}" not in input set`
        );
      }
    }
  }

  return {
    ranked: parsed.ranked,
    source: 'haiku',
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
  };
}

function buildStancesBlock(candidates: CandidateWithFullData[]): string {
  const lines: string[] = ['Candidates and their stances:'];
  for (const c of candidates) {
    lines.push('');
    lines.push(`## ${c.name} (id: ${c.id}, party: ${c.primary_party ?? 'I'}, ${c.incumbent ? 'incumbent' : 'challenger'})`);
    if (c.bio) lines.push(`Bio: ${c.bio}`);
    if (c.total_raised) lines.push(`Raised: $${c.total_raised.toLocaleString()}`);
    if (c.top_industries && c.top_industries.length > 0) {
      lines.push(
        `Top funding industries: ${c.top_industries
          .slice(0, 5)
          .map((i) => i.industry_name)
          .join(', ')}`
      );
    }
    lines.push('Stances:');
    for (const s of c.top_stances) {
      lines.push(
        `- ${s.issue_slug} | stance_id=${s.stance_id} | ${s.stance} | ${s.summary}${s.track_record_note ? ` | track_record: ${s.track_record_note}` : ''}`
      );
    }
  }
  return lines.join('\n');
}

function extractJson(text: string): unknown {
  // Strip code fences if present, then find the first { ... } block.
  const cleaned = text.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

// ============================================================
// Mock ranking (no API key)
// ============================================================

const STANCE_VALUES: Record<Stance, number> = {
  strongly_support: 1,
  support: 0.5,
  neutral: 0,
  oppose: -0.5,
  strongly_oppose: -1,
};

/**
 * Heuristic scoring without an LLM. Matches the user's quick-poll weights and
 * a simple keyword scan of their free text against each candidate's stances.
 * Deterministic given the same input.
 */
function mockRank(input: MatchInput): MatchResult[] {
  const weights = new Map<string, number>();
  for (const q of input.quick_poll ?? []) {
    weights.set(q.issue_slug, q.weight);
  }

  const text = input.free_text.toLowerCase();
  const sentimentBoost = (slug: string): number => {
    // Simple keyword-based sentiment: if user mentions issue keywords with
    // supportive language, candidates with supportive stances score higher.
    if (text.includes(slug.replace('_', ' ')) || text.includes(slug)) {
      return 1;
    }
    return 0;
  };

  const ranked = input.candidates.map((c) => {
    let totalScore = 0;
    let totalWeight = 0;
    // Track every stance with its contribution, then surface the top
    // contributors as matched_stances regardless of an arbitrary threshold.
    const contributions: Array<{ stance_id: string; issue_slug: string; contribution: number }> = [];

    for (const stance of c.top_stances) {
      const weight = (weights.get(stance.issue_slug) ?? 3) + sentimentBoost(stance.issue_slug);
      const stanceValue = STANCE_VALUES[stance.stance];
      // Higher absolute stance value with higher user weight = more impact.
      const contribution = weight * Math.abs(stanceValue);
      totalScore += contribution;
      totalWeight += weight;

      const note = stance.track_record_note ?? '';
      const isContradiction = /contradict|⚠/i.test(note) || /top donor/i.test(note);
      if (isContradiction) totalScore -= weight * 0.3;

      contributions.push({
        stance_id: stance.stance_id,
        issue_slug: stance.issue_slug,
        contribution,
      });
    }

    const normalizedScore = totalWeight > 0
      ? Math.max(0, Math.min(100, Math.round((totalScore / totalWeight) * 100)))
      : 50;

    // Top 3 contributors form the matched_stances + rationale.
    contributions.sort((a, b) => b.contribution - a.contribution);
    const top = contributions.slice(0, 3);
    const matchedStances = top.map((t) => t.stance_id);
    const rationale = top.length > 0 && top[0].contribution > 0
      ? `Closest alignment on ${top.map((t) => t.issue_slug).join(', ')}.`
      : 'Limited overlap with your priorities.';

    return {
      candidate_id: c.id,
      score: normalizedScore,
      matched_stances: matchedStances,
      rationale,
    };
  });

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

// ============================================================
// Test helpers (export for tests, not used in app code)
// ============================================================

export const __test = { mockRank, buildStancesBlock, extractJson };
