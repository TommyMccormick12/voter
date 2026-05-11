// Pull recent public statements about each candidate via NewsAPI.org,
// summarize via Haiku into structured `candidate_statements` rows, and
// merge into the race fixture. Complements fetch_statements.ts (which
// scrapes campaign sites) and the inline candidate_statements table
// populated by other ingesters.
//
// Why a separate script (not part of fetch_statements.ts):
//   The campaign-site scraper is heuristic + brittle. NewsAPI gives us
//   broader coverage (anyone the press has covered) with structured
//   metadata (publishedAt, source, url). Cleanest to keep the two
//   paths composable rather than merging the failure modes.
//
// NewsAPI tier: free 100 req/day, 1-month rolling archive. One request
// per candidate is fine for Tier 1 (16 races × ~5 candidates = ~80 req).
// Tier 2 (~100 more candidates) crosses the daily limit — spread over
// 2 days or upgrade.
//
// Env: NEWSAPI_KEY. Without it, the script no-ops with a friendly
// warning so the rest of the pipeline still completes.
//
// Usage:
//   NEWSAPI_KEY=... ANTHROPIC_API_KEY=... \
//     npx tsx scripts/ingest/fetch_news_statements.ts \
//     --race-id race-fl-sen-d-2026

import '../_env';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  CANDIDATE_FIXTURE_DIR,
  RAW_CACHE_DIR,
  fetchCached,
} from '../../src/lib/api-clients/base';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const HAIKU_MODEL = 'claude-haiku-4-5';
const NEWSAPI_BASE = 'https://newsapi.org/v2/everything';
const ISSUE_SLUGS = [
  'economy', 'healthcare', 'immigration', 'climate', 'education',
  'guns', 'criminal_justice', 'foreign_policy', 'taxes', 'housing',
] as const;

interface Args {
  raceId: string;
  /** Days back from today (NewsAPI free tier: max 30). */
  daysBack: number;
  /** Hard cap per candidate so we don't blow Haiku budget on a single noisy candidate. */
  maxArticles: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId = '';
  let daysBack = 30;
  let maxArticles = 10;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
    else if (args[i] === '--days-back') daysBack = parseInt(args[++i] ?? '', 10);
    else if (args[i] === '--max-articles') maxArticles = parseInt(args[++i] ?? '', 10);
  }
  if (!raceId) {
    console.error('Usage: --race-id "..." [--days-back 30] [--max-articles 10]');
    process.exit(1);
  }
  return { raceId, daysBack, maxArticles };
}

interface NewsApiArticle {
  source: { id: string | null; name: string };
  author: string | null;
  title: string;
  description: string | null;
  url: string;
  publishedAt: string;
  content: string | null;
}

interface NewsApiResponse {
  status: string;
  totalResults: number;
  articles: NewsApiArticle[];
  message?: string;
}

const StatementSchema = z.object({
  statement_text: z.string().min(20).max(500),
  issue_slugs: z.array(z.enum(ISSUE_SLUGS)).min(0).max(3),
});
const SummarySchema = z.object({
  statements: z.array(StatementSchema).min(0).max(10),
});

/**
 * Summarize a batch of articles (headlines + descriptions) into structured
 * statement rows. Haiku produces ≤10 statements per call; we keep the
 * input bounded to ~maxArticles articles per candidate. Cached on disk
 * by candidate-slug + articles content hash.
 */
async function summarizeWithHaiku(
  candidateName: string,
  articles: NewsApiArticle[],
): Promise<z.infer<typeof SummarySchema>['statements']> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[news] ANTHROPIC_API_KEY not set — skipping Haiku summarization');
    return [];
  }
  // Cache key includes article URLs so a fresh news cycle invalidates.
  const cacheTag =
    articles
      .map((a) => a.url)
      .sort()
      .join('|') || 'empty';
  const cacheFile = join(
    RAW_CACHE_DIR,
    'anthropic-news',
    `${candidateName.toLowerCase().replace(/\s+/g, '_')}-${hash(cacheTag)}.json`,
  );
  if (existsSync(cacheFile)) {
    try {
      return JSON.parse(readFileSync(cacheFile, 'utf8')).statements;
    } catch {
      // ignore parse failure; fall through and re-call
    }
  }

  const client = new Anthropic({ apiKey });
  const articlesBlock = articles
    .map(
      (a, i) =>
        `${i + 1}. [${a.source.name} · ${a.publishedAt.slice(0, 10)}] "${a.title}"\n   ${a.description ?? ''}`,
    )
    .join('\n\n');

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1500,
    system: [
      {
        type: 'text',
        text:
          'You read news article headlines+descriptions about a US political candidate and extract structured `statements` ' +
          'about that candidate\'s stated positions, voted actions, or public remarks. Output VALID JSON ONLY: ' +
          '`{"statements":[{"statement_text":"...","issue_slugs":["..."]}]}`. ' +
          'Rules: (1) statement_text is a 1-2 sentence neutral summary in third person, attributed where useful ' +
          '(e.g. "Said on Fox News that..." or "Voted YES on..."). 20-500 chars. ' +
          '(2) issue_slugs is 0-3 tags from: ' +
          ISSUE_SLUGS.join(', ') +
          '. Omit if no clear issue tie. ' +
          '(3) Skip articles that are pure horse-race ("polling shows X up 5pts"), endorsements, or fundraising totals. ' +
          'Only keep substantive position/action statements. ' +
          '(4) Output `{"statements":[]}` when nothing substantive exists. Never editorialize.',
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Candidate: ${candidateName}\n\nArticles:\n${articlesBlock}\n\nProduce statements JSON.`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') return [];
  const cleaned = textBlock.text.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return [];
  }
  const result = SummarySchema.safeParse(parsed);
  if (!result.success) {
    console.warn('[news] Haiku output failed Zod:', result.error.message);
    return [];
  }

  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(
    cacheFile,
    JSON.stringify(
      {
        statements: result.data.statements,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
      null,
      2,
    ),
  );
  return result.data.statements;
}

function hash(s: string): string {
  // FNV-1a-like; not crypto, just for cache key
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

async function main() {
  const { raceId, daysBack, maxArticles } = parseArgs();
  const newsKey = process.env.NEWSAPI_KEY;
  if (!newsKey) {
    console.warn(
      '[news] NEWSAPI_KEY not set. Sign up at https://newsapi.org (free tier: 100 req/day) and add to .env.local.',
    );
    process.exit(0);
  }
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`[news] fixture missing: ${partialPath}`);
    process.exit(1);
  }

  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const state = fixture.race?.state ?? '';
  const candidates: Array<Record<string, unknown> & { name?: string; statements?: unknown[] }> =
    fixture.candidates ?? [];

  const from = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);
  let totalAdded = 0;

  for (const c of candidates) {
    if (!c.name || typeof c.name !== 'string') continue;

    // Query: candidate name + state for disambiguation (Joshua Weil shows
    // up in non-FL articles too). Quote the name to keep the phrase intact.
    const q = encodeURIComponent(`"${c.name}" ${state}`);
    const url = `${NEWSAPI_BASE}?q=${q}&from=${from}&sortBy=publishedAt&pageSize=${maxArticles}&language=en&apiKey=${newsKey}`;
    let resp: NewsApiResponse;
    try {
      resp = await fetchCached<NewsApiResponse>(url, { cacheTag: 'newsapi-v1' });
    } catch (err) {
      console.warn(`[news] ${c.name}: fetch failed`, (err as Error).message);
      continue;
    }
    if (resp.status !== 'ok') {
      console.warn(`[news] ${c.name}: NewsAPI status=${resp.status} (${resp.message})`);
      continue;
    }
    if (resp.articles.length === 0) {
      console.log(`[news] ${c.name}: 0 articles in last ${daysBack} days`);
      continue;
    }

    const summarized = await summarizeWithHaiku(c.name, resp.articles.slice(0, maxArticles));
    if (summarized.length === 0) {
      console.log(`[news] ${c.name}: ${resp.articles.length} articles → 0 substantive statements`);
      continue;
    }

    // Merge into fixture as candidate_statements-shaped rows. Use the first
    // article URL as the source_url (Haiku synthesizes across the batch).
    const newStatements = summarized.map((s) => ({
      statement_text: s.statement_text,
      statement_date: from, // batch-summarized; pin to from-date as coarse anchor
      context: 'press_release' as const,
      issue_slugs: s.issue_slugs,
      source_url: resp.articles[0]?.url ?? '',
      source_quality: 70,
      data_source: 'news',
    }));
    const existing = Array.isArray(c.statements) ? (c.statements as unknown[]) : [];
    c.statements = [...existing, ...newStatements];
    totalAdded += newStatements.length;
    console.log(`[news] ${c.name}: +${newStatements.length} statements (from ${resp.articles.length} articles)`);
  }

  writeFileSync(partialPath, JSON.stringify(fixture, null, 2));
  console.log(`[news] wrote ${partialPath}. ${totalAdded} statements added total.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
