// Industry classification via Anthropic Haiku.
//
// Why this exists: OpenSecrets and FollowTheMoney both retired their public
// APIs. We have FEC's itemized contribution data (employer + occupation
// strings + amounts) — Haiku does the industry bucketing that those
// services used to do.
//
// Input:  list of { employer, occupation, amount } from FEC schedule A
// Output: { donor_industries: [{industry, amount, contributor_count}],
//           classifications: [{employer, industry}] } — Zod-validated
//
// Cost: ~$0.007 per candidate (one batched call, ~3K input / ~800 output tokens).
// Tier 1 FL (~50 candidates): ~$0.35 total.

import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { REPO_ROOT } from '../api-clients/base';

// ============================================================
// Taxonomy — fixed industry buckets. Haiku must pick from this list,
// validated by Zod. Picked to mirror OpenSecrets' top-level sector
// categories but condensed for product clarity (no point showing 100
// industries on a small mobile card).
// ============================================================

export const INDUSTRY_BUCKETS = [
  'Real Estate',
  'Oil & Gas',
  'Technology',
  'Finance & Banking',
  'Healthcare & Pharma',
  'Defense & Aerospace',
  'Legal',
  'Labor Unions',
  'Education',
  'Retail & Consumer Goods',
  'Media & Entertainment',
  'Agriculture',
  'Telecom',
  'Construction',
  'Transportation',
  'Government / Public Sector',
  'Nonprofit / Civic',
  'Retired / Self-Employed',
  'Other',
] as const;

export type IndustryBucket = (typeof INDUSTRY_BUCKETS)[number];

const IndustrySchema = z.enum(INDUSTRY_BUCKETS);

// ============================================================
// Public types
// ============================================================

export interface ContributorInput {
  /** Employer string as reported to FEC. May be empty/blank. */
  employer: string;
  /** Occupation string as reported. Often "Self-Employed", "Retired", etc. */
  occupation: string;
  /** Total contributions from this employer×occupation pair in the cycle. */
  amount: number;
  /** Number of distinct contributions aggregated into this row. */
  contributor_count: number;
}

export interface IndustryRollup {
  industry: IndustryBucket;
  amount: number;
  contributor_count: number;
  rank: number;
}

export interface ClassifyResult {
  /** Sorted by amount desc, top buckets first. Always covers all input contributions. */
  industries: IndustryRollup[];
  /** Per-input mapping so seed scripts can attribute each donor to a bucket. */
  classifications: Array<{ employer: string; occupation: string; industry: IndustryBucket }>;
  source: 'haiku' | 'cache';
  input_tokens?: number;
  output_tokens?: number;
}

// ============================================================
// Haiku output schema — strict, validates every classification
// ============================================================

const HaikuResponseSchema = z.object({
  classifications: z
    .array(
      z.object({
        index: z.number().int().min(0),
        industry: IndustrySchema,
      }),
    )
    .min(1),
});

// ============================================================
// Disk cache — keyed by hash of input contributor set. Re-runs are free.
// ============================================================

const CACHE_DIR = join(REPO_ROOT, 'supabase', 'seed', 'raw', 'anthropic-classify');

function inputHash(contributors: ContributorInput[]): string {
  // Stable serialization: same input → same hash, regardless of object key order.
  const serialized = contributors
    .map((c) => `${c.employer.trim().toLowerCase()}|${c.occupation.trim().toLowerCase()}|${c.amount}|${c.contributor_count}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(serialized).digest('hex');
}

function loadCached(hash: string): ClassifyResult | null {
  const path = join(CACHE_DIR, `${hash}.json`);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ClassifyResult;
    return { ...parsed, source: 'cache' };
  } catch {
    return null;
  }
}

function writeCache(hash: string, result: ClassifyResult): void {
  const path = join(CACHE_DIR, `${hash}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(result, null, 2));
}

// ============================================================
// Public API
// ============================================================

const HAIKU_MODEL = 'claude-haiku-4-5';

/**
 * Classify a candidate's itemized contributors into industry buckets,
 * then aggregate amounts. One Haiku call per input set; cached on disk
 * by content hash so re-runs are free.
 *
 * If `contributors` is empty, returns empty industries with no API call.
 * If ANTHROPIC_API_KEY is unset, throws (caller decides whether to skip).
 */
export async function classifyIndustries(
  contributors: ContributorInput[],
): Promise<ClassifyResult> {
  if (contributors.length === 0) {
    return { industries: [], classifications: [], source: 'haiku' };
  }

  const hash = inputHash(contributors);
  const cached = loadCached(hash);
  if (cached) return cached;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'classify-industries: ANTHROPIC_API_KEY required. Set it in .env.local or ' +
        'skip this step (donor profile will fall back to raw FEC names without industry buckets).',
    );
  }

  // Build the Haiku prompt. Indexed list so Haiku returns by index (cheaper
  // than echoing the employer strings back).
  const taxonomyList = INDUSTRY_BUCKETS.map((b) => `- ${b}`).join('\n');
  const inputList = contributors
    .map((c, i) => {
      const occ = c.occupation ? ` | ${c.occupation}` : '';
      return `${i}. ${c.employer || '(blank)'}${occ}`;
    })
    .join('\n');

  const userPrompt = `Classify each contributor below into exactly one industry bucket from the fixed taxonomy. Return JSON ONLY.

Taxonomy (use these exact strings):
${taxonomyList}

Rules:
- "(blank)" employer → use occupation. If occupation is "Retired" or "Self-Employed" → "Retired / Self-Employed".
- Unknown / unclassifiable → "Other".
- Government employees (federal/state/local) → "Government / Public Sector".
- Defense contractors (Lockheed, Raytheon, Boeing defense, etc.) → "Defense & Aerospace".
- Banks, hedge funds, private equity, fintech → "Finance & Banking".
- Big tech (Google, Meta, Microsoft, Apple, etc.) + startups + SaaS → "Technology".
- Oil/gas/coal/pipeline/refining → "Oil & Gas".
- Hospitals, biotech, pharma, insurers → "Healthcare & Pharma".
- Law firms, plaintiffs' attorneys → "Legal".
- Unions, labor organizations → "Labor Unions".
- Schools, universities, ed-tech → "Education".

Contributors:
${inputList}

Output schema: {"classifications":[{"index":N,"industry":"<exact bucket string>"}, ...]} — one entry per input, no others, no preamble.`;

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 4096,
    system:
      'You are an industry classifier for campaign-finance data. Output VALID JSON ONLY matching the requested schema. Never invent industries outside the provided taxonomy.',
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Haiku returned no text content');
  }

  const json = extractJson(textBlock.text);
  const parsed = HaikuResponseSchema.parse(json);

  // Sanity: every input must be classified, indexes must be in range
  if (parsed.classifications.length !== contributors.length) {
    throw new Error(
      `Haiku returned ${parsed.classifications.length} classifications, expected ${contributors.length}`,
    );
  }
  for (const c of parsed.classifications) {
    if (c.index < 0 || c.index >= contributors.length) {
      throw new Error(`Haiku returned out-of-range index ${c.index}`);
    }
  }

  // Build per-input mapping
  const classifications = parsed.classifications
    .sort((a, b) => a.index - b.index)
    .map((c) => ({
      employer: contributors[c.index].employer,
      occupation: contributors[c.index].occupation,
      industry: c.industry,
    }));

  // Aggregate amounts by industry
  const byIndustry = new Map<IndustryBucket, { amount: number; contributor_count: number }>();
  for (let i = 0; i < contributors.length; i++) {
    const industry = parsed.classifications.find((c) => c.index === i)?.industry;
    if (!industry) continue;
    const cur = byIndustry.get(industry) ?? { amount: 0, contributor_count: 0 };
    cur.amount += contributors[i].amount;
    cur.contributor_count += contributors[i].contributor_count;
    byIndustry.set(industry, cur);
  }

  const industries: IndustryRollup[] = Array.from(byIndustry.entries())
    .map(([industry, agg]) => ({ industry, amount: agg.amount, contributor_count: agg.contributor_count, rank: 0 }))
    .sort((a, b) => b.amount - a.amount)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  const result: ClassifyResult = {
    industries,
    classifications,
    source: 'haiku',
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
  };

  writeCache(hash, result);
  return result;
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in Haiku response');
  return JSON.parse(cleaned.slice(start, end + 1));
}
