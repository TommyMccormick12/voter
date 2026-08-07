// Fetch recent public statements about each candidate via GDELT DOC 2.0
// (free, keyless full-text news search), domain-pinned to Florida outlets.
//
// Replaces the retired NewsAPI ingester slot (fetch_news_statements.ts,
// kept for now — see scripts/README.md) as the tertiary stance source
// (Decision 5, DECISIONS-2026-08-06.md: "GDELT news mining (replaces
// NewsAPI)"). Complements fetch_statements.ts (campaign-site scrape) and
// the inline candidate_statements rows populated by other ingesters.
//
// Attribution discipline (the hard lesson behind this file): GDELT's DOC
// API returns index metadata only (title, url, seendate, domain — no
// article body), and a name match against the search query alone is not
// proof the article is actually about our candidate. So this script:
//   1. Fetches each candidate's own article HTML itself and extracts the
//      body text — a statement is never built from the GDELT snippet.
//   2. Attaches ONLY when the candidate's FULL name (normalized the same
//      way scripts/review/activation-gate.ts does for the DOE/FEC spine
//      match) appears in the article title or the fetched body text.
//      Partial or last-name-only matches never attach (see
//      DATA-AUDIT-2026-08-06's Royal-Webster-vs-Daniel-Webster
//      misattribution, which fetch_votes.ts's ID-only crosswalk exists to
//      prevent on the votes side — this is the equivalent discipline for
//      name-matched news text, where there is no ID to key on).
//   3. Drops (with a console.log count) any article that names no
//      candidate, or whose fetch fails — never falls back to attaching
//      GDELT's index metadata as if it were a statement.
//
// Stale-data rule: every run replaces ONLY the statements this ingester
// previously attached (marked `data_source: 'gdelt'` in the fixture, a
// fixture-only field — seed_candidates.ts's stmtRows mapping does not
// forward it to the DB row, same as fetch_news_statements.ts's `'news'`
// marker). Statements from other ingesters (no data_source, or a
// different one) are left untouched.
//
// Usage:
//   npx tsx scripts/ingest/fetch_gdelt_statements.ts \
//     --race-id race-fl-13-r-2026 --state FL

import '../_env';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import {
  searchArticles,
  fetchArticleHtml,
  FLORIDA_NEWS_DOMAINS,
  type GdeltArticle,
  type SearchArticlesOptions,
} from '../../src/lib/api-clients/gdelt';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';
import { normalizeIdentityName } from '../review/activation-gate';
import { ISSUE_NAMES } from '../../src/lib/issues';

/** Fixture-only marker (never written to the DB — see file header). Used
 * both to tag rows this ingester writes and to find-and-replace them on
 * the next run without touching rows from other ingesters. */
export const GDELT_DATA_SOURCE = 'gdelt';

const DEFAULT_MAX_ARTICLES_PER_CANDIDATE = 8;
const MIN_STATEMENT_TEXT_LEN = 20;
const MAX_STATEMENT_TEXT_LEN = 500;
const SOURCE_QUALITY = 65; // between fetch_statements.ts's 60 (unverified scrape) and fetch_news_statements.ts's 70 (Haiku-summarized)

interface Args {
  raceId: string;
  state: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId = '';
  let state = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
    if (args[i] === '--state') state = args[++i] ?? '';
  }
  if (!raceId) {
    console.error('Usage: --race-id "..." [--state FL]');
    process.exit(1);
  }
  return { raceId, state };
}

// Heuristic keyword -> issue slug mapping, same conservative approach as
// fetch_votes.ts's inferIssues: better to miss a tag than to mis-tag,
// since these feed Haiku synthesis.
const ISSUE_KEYWORDS: Array<[RegExp, keyof typeof ISSUE_NAMES]> = [
  [/\btax(es|ation)?\b|\bjobs\b|\beconomy\b|\bwages?\b/i, 'economy'],
  [/\bhealth\s?care\b|\bmedicare\b|\bmedicaid\b|\bobamacare\b|\bprescription\b/i, 'healthcare'],
  [/\bimmigration\b|\bborder\b|\basylum\b|\bdeport/i, 'immigration'],
  [/\bclimate\b|\bemissions?\b|\bclean energy\b|\bepa\b|\bfossil fuel/i, 'climate'],
  [/\beducation\b|\bstudent loans?\b|\bschools?\b|\bteachers?\b/i, 'education'],
  [/\bfirearms?\b|\bguns?\b|\bsecond amendment\b/i, 'guns'],
  [/\bcriminal justice\b|\bprisons?\b|\bsentencing\b|\bpolice\b/i, 'criminal_justice'],
  [/\bforeign policy\b|\bukraine\b|\bisrael\b|\bchina\b|\bnato\b|\bmilitary\b|\bdefense\b/i, 'foreign_policy'],
  [/\bhousing\b|\brent\b|\bmortgage\b|\bhud\b/i, 'housing'],
];

function inferIssueSlugs(title: string, text: string): string[] {
  const haystack = `${title} ${text}`;
  const slugs: string[] = [];
  for (const [re, slug] of ISSUE_KEYWORDS) {
    if (slugs.length >= 3) break;
    if (re.test(haystack)) slugs.push(slug);
  }
  return slugs;
}

/**
 * Extract body paragraph text from article HTML. Generic news outlets
 * (not bespoke campaign sites), so this deliberately just joins every
 * <p> — no article/press-release-specific selectors like
 * fetch_statements.ts uses for campaign sites.
 */
export function extractArticleText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, aside').remove();
  const paragraphs = $('p')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((t) => t.length > 0);
  return paragraphs.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Whole-word-boundary check for the candidate's full name inside some
 * text, both sides normalized identically to activation-gate.ts's spine
 * match (diacritics/punctuation stripped, lowercased). Padding both the
 * haystack and the target with spaces before the substring check is what
 * makes this whole-word rather than a raw substring test — "annabelle
 * paulina luna" does not contain " anna paulina luna " even though it
 * contains "anna" as a raw substring.
 */
export function nameAppearsIn(candidateName: string, haystack: string): boolean {
  const target = normalizeIdentityName(candidateName);
  if (!target) return false;
  const padded = ` ${normalizeIdentityName(haystack)} `;
  return padded.includes(` ${target} `);
}

/**
 * Build a statement excerpt from fetched article text. Centers the
 * excerpt on the candidate's name when a raw (non-normalized) match is
 * findable; otherwise falls back to the start of the text — the
 * normalized nameAppearsIn() check has already confirmed the name is
 * genuinely present somewhere, just not necessarily at an index the raw
 * case-insensitive search can find (diacritics, curly quotes, etc.).
 * Returns null when there isn't enough text to form a real statement
 * (MIN_STATEMENT_TEXT_LEN) — callers must drop, never fall back to the
 * GDELT index snippet.
 */
export function excerptAroundName(text: string, candidateName: string): string | null {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length < MIN_STATEMENT_TEXT_LEN) return null;
  const idx = trimmed.toLowerCase().indexOf(candidateName.toLowerCase());
  const start = idx >= 0 ? Math.max(0, idx - 80) : 0;
  const slice = trimmed.slice(start, start + MAX_STATEMENT_TEXT_LEN).trim();
  return slice.length >= MIN_STATEMENT_TEXT_LEN ? slice : null;
}

export interface GdeltCandidate {
  name?: string;
  statements?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export type GdeltSearchFn = (query: string, opts?: SearchArticlesOptions) => Promise<GdeltArticle[]>;
export type FetchArticleTextFn = (url: string) => Promise<string>;

export interface AttachGdeltStatementsOptions {
  state?: string;
  domains?: readonly string[];
  timespan?: string;
  maxArticlesPerCandidate?: number;
  /** Injectable article-body fetch, defaulting to the real HTML fetch +
   * extraction. Tests override this to simulate fetch failures without a
   * network call — see tests/fetch_gdelt_statements.test.ts. */
  fetchArticleText?: FetchArticleTextFn;
}

async function defaultFetchArticleText(url: string): Promise<string> {
  const html = await fetchArticleHtml(url);
  return extractArticleText(html);
}

/**
 * Attach GDELT-sourced statements to each candidate, mutating in place.
 * Dependency-injected (searchFn) so this is unit-testable with no network
 * or fs access — see tests/fetch_gdelt_statements.test.ts. Shaped after
 * fetch_votes.ts's attachVotingRecords: same mutate-in-place contract,
 * same "exported pure-ish attach function + separate CLI main()" split.
 */
export async function attachGdeltStatements(
  candidates: GdeltCandidate[],
  searchFn: GdeltSearchFn,
  opts: AttachGdeltStatementsOptions = {},
): Promise<void> {
  const {
    state = '',
    domains = FLORIDA_NEWS_DOMAINS,
    timespan = '6months',
    maxArticlesPerCandidate = DEFAULT_MAX_ARTICLES_PER_CANDIDATE,
    fetchArticleText = defaultFetchArticleText,
  } = opts;

  let totalAttached = 0;
  let totalDroppedNoMatch = 0;
  let totalDroppedFetchFailed = 0;

  for (const c of candidates) {
    const name = typeof c.name === 'string' ? c.name : '';
    if (!name) {
      console.log('[gdelt] (unnamed candidate): skipped — no name to search or match against');
      continue;
    }

    const query = state ? `"${name}" ${state}` : `"${name}"`;
    let articles: GdeltArticle[];
    try {
      articles = await searchFn(query, { domains, timespan, maxRecords: maxArticlesPerCandidate });
    } catch (err) {
      console.warn(`[gdelt] ${name}: search failed —`, err instanceof Error ? err.message : err);
      articles = [];
    }

    const attachedRows: Array<Record<string, unknown>> = [];
    let droppedNoMatch = 0;
    let droppedFetchFailed = 0;

    for (const article of articles.slice(0, maxArticlesPerCandidate)) {
      let text: string;
      try {
        text = await fetchArticleText(article.url);
      } catch (err) {
        droppedFetchFailed++;
        console.warn(
          `[gdelt] ${name}: dropping ${article.url} — article fetch failed ` +
            `(${err instanceof Error ? err.message : err}), refusing to attach index metadata as a statement`,
        );
        continue;
      }

      const matched = nameAppearsIn(name, article.title) || nameAppearsIn(name, text);
      if (!matched) {
        droppedNoMatch++;
        continue;
      }

      const excerpt = excerptAroundName(text, name);
      if (!excerpt) {
        // Name matched, but the fetched page had no usable body text (e.g.
        // a paywall/consent stub). Same rule as a fetch failure: never
        // substitute the GDELT index snippet for real article content.
        droppedFetchFailed++;
        console.warn(`[gdelt] ${name}: dropping ${article.url} — fetched article had no usable text`);
        continue;
      }

      attachedRows.push({
        statement_text: excerpt,
        statement_date: article.seenDate,
        context: 'news',
        issue_slugs: inferIssueSlugs(article.title, text),
        source_url: article.url,
        source_quality: SOURCE_QUALITY,
        data_source: GDELT_DATA_SOURCE,
      });
    }

    // Stale-data rule: replace only this ingester's own prior rows.
    const existing = Array.isArray(c.statements) ? c.statements : [];
    const others = existing.filter(
      (s) => (s as Record<string, unknown>).data_source !== GDELT_DATA_SOURCE,
    );
    c.statements = [...others, ...attachedRows];

    totalAttached += attachedRows.length;
    totalDroppedNoMatch += droppedNoMatch;
    totalDroppedFetchFailed += droppedFetchFailed;

    console.log(
      `[gdelt] ${name}: ${articles.length} articles -> +${attachedRows.length} statements ` +
        `(dropped ${droppedNoMatch} no unambiguous match, ${droppedFetchFailed} fetch-failed)`,
    );
  }

  console.log(
    `[gdelt] done: ${totalAttached} statements attached, ${totalDroppedNoMatch} dropped ` +
      `(no unambiguous match), ${totalDroppedFetchFailed} dropped (article fetch failed)`,
  );
}

async function main() {
  const { raceId, state } = parseArgs();
  console.log(`[gdelt] ${raceId} (${state || 'no state filter'}) — full-name-only attribution, FL domain-pinned`);
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`Partial fixture missing: ${partialPath}. Run fetch_fec/fetch_ballotpedia first.`);
    process.exit(1);
  }
  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const candidates: GdeltCandidate[] = fixture.candidates ?? [];

  await attachGdeltStatements(candidates, searchArticles, { state });

  writeFileSync(partialPath, JSON.stringify(fixture, null, 2));
  console.log(`[gdelt] wrote ${partialPath}`);
}

// Only run the CLI when this file is the process entry point — importing
// attachGdeltStatements from tests must never parse argv or call
// process.exit. Same isMain pattern as fetch_votes.ts.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
