// Haiku-based extraction of candidate platform / policy positions from
// long-form Wikipedia "Political positions" section text.
//
// Why this exists: Wikipedia provides rich biographical and policy-position
// data for major federal candidates as free-form prose. We need it as
// structured `{issue_slug, summary, source_excerpt}` rows so synth:stances
// can use it the same way it used Ballotpedia key_messages.
//
// Cost: ~$0.003-0.008 per candidate depending on section length. Tier 1
// FL: ~$0.25 total. Cached on disk by content hash; re-runs are free.

import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { REPO_ROOT } from '../api-clients/base';

const HAIKU_MODEL = 'claude-haiku-4-5';

// Same 10-issue taxonomy synth:stances uses
export const ISSUE_SLUGS = [
  'economy',
  'healthcare',
  'immigration',
  'climate',
  'education',
  'guns',
  'criminal_justice',
  'foreign_policy',
  'taxes',
  'housing',
] as const;

const IssueSchema = z.enum(ISSUE_SLUGS);

const PositionSchema = z.object({
  issue_slug: IssueSchema,
  /** 1-2 sentence summary in the candidate's own framing where possible. */
  summary: z.string().min(10).max(400),
  /** Direct quote / paraphrase from the source text for traceability. */
  source_excerpt: z.string().min(10).max(400),
});

const ExtractionSchema = z.object({
  positions: z.array(PositionSchema).min(0).max(10),
});

export interface PlatformPosition {
  issue_slug: (typeof ISSUE_SLUGS)[number];
  summary: string;
  source_excerpt: string;
}

export interface ExtractResult {
  positions: PlatformPosition[];
  source: 'haiku' | 'cache';
  input_tokens?: number;
  output_tokens?: number;
}

const CACHE_DIR = join(REPO_ROOT, 'supabase', 'seed', 'raw', 'anthropic-platform');

function inputHash(name: string, text: string): string {
  return createHash('sha256').update(`${name}\n${text}`).digest('hex');
}

function loadCached(hash: string): ExtractResult | null {
  const path = join(CACHE_DIR, `${hash}.json`);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ExtractResult;
    return { ...parsed, source: 'cache' };
  } catch {
    return null;
  }
}

function writeCache(hash: string, result: ExtractResult): void {
  const path = join(CACHE_DIR, `${hash}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(result, null, 2));
}

/**
 * Extract structured policy positions from a candidate's long-form text
 * (typically Wikipedia's "Political positions" section). Returns 0-10
 * positions keyed to our standard issue taxonomy. Skips issues not
 * covered in the source — never invents positions.
 */
export async function extractPlatform(
  candidateName: string,
  rawText: string,
): Promise<ExtractResult> {
  if (!rawText || rawText.length < 50) {
    return { positions: [], source: 'haiku' };
  }

  const hash = inputHash(candidateName, rawText);
  const cached = loadCached(hash);
  if (cached) return cached;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('extract-platform: ANTHROPIC_API_KEY required.');
  }

  // Cap input length to control cost. Wikipedia Political positions
  // sections are usually 3-15K chars; 20K is a safe upper bound.
  const truncated = rawText.length > 20_000 ? rawText.slice(0, 20_000) : rawText;

  const issueList = ISSUE_SLUGS.map((s) => `  - ${s}`).join('\n');

  const userPrompt = `You are extracting structured policy positions from a Wikipedia article about a U.S. political candidate. Output VALID JSON ONLY.

Candidate: ${candidateName}

Source text (from Wikipedia "Political positions" section):
"""
${truncated}
"""

Task: Extract up to 10 policy positions, one per issue slug from this taxonomy:
${issueList}

Rules:
- Only include issues where the source text contains a substantive statement of the candidate's position. Skip issues with no signal.
- summary: 1-2 sentences in plain English, faithful to the source. No editorializing.
- source_excerpt: a short verbatim quote or close paraphrase from the source supporting the position. Must be present in or directly paraphrased from the source text.
- Never invent positions. Never include issues with no source coverage.
- If the source describes multiple positions on one issue, pick the most recent / most clearly stated.

Output schema: {"positions": [{"issue_slug": "<one of taxonomy>", "summary": "...", "source_excerpt": "..."}]}`;

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 2048,
    system:
      'You are a non-partisan extractor of candidate policy positions from public sources. Output VALID JSON ONLY matching the requested schema. Never invent positions not in the source. issue_slug must be exactly one of: economy, healthcare, immigration, climate, education, guns, criminal_justice, foreign_policy, taxes, housing.',
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Haiku returned no text content');
  }

  const cleaned = textBlock.text.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in Haiku response');
  const json = JSON.parse(cleaned.slice(start, end + 1));
  const parseResult = ExtractionSchema.safeParse(json);
  if (!parseResult.success) {
    console.error('[extract-platform] Zod validation failed. Raw response:');
    console.error(JSON.stringify(json, null, 2));
    throw parseResult.error;
  }

  const result: ExtractResult = {
    positions: parseResult.data.positions,
    source: 'haiku',
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
  };
  writeCache(hash, result);
  return result;
}
