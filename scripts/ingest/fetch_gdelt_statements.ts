// Fetch recent public statements about each candidate via GDELT DOC 2.0
// (free, keyless full-text news search), domain-pinned to Florida outlets.
//
// Replaces the retired NewsAPI ingester (fetch_news_statements.ts —
// deleted; nothing else imported it) as the tertiary stance source
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
//      match) appears in the fetched article BODY text — the GDELT title
//      alone is not sufficient (2026-08-07 review: a title-only match let
//      unrelated paywall/consent boilerplate that never actually mentions
//      the candidate get attached as their "statement"). Partial or
//      last-name-only matches never attach (see DATA-AUDIT-2026-08-06's
//      Royal-Webster-vs-Daniel-Webster misattribution, which
//      fetch_votes.ts's ID-only crosswalk exists to prevent on the votes
//      side — this is the equivalent discipline for name-matched news
//      text, where there is no ID to key on).
//   3. Drops (with a console.log count) any article that names no
//      candidate, or whose fetch fails — never falls back to attaching
//      GDELT's index metadata as if it were a statement.
//
// Stale-data rule: every run replaces ONLY the statements this ingester
// previously attached (marked `data_source: 'gdelt'` in the fixture, a
// fixture-only field — seed_candidates.ts's stmtRows mapping does not
// forward it to the DB row, same as the old NewsAPI ingester's `'news'`
// marker). Statements from other ingesters (no data_source, or a
// different one) are left untouched. A candidate whose SEARCH fails
// (network error, exhausted GDELT retries, etc.) is skipped entirely —
// see the try/catch in attachGdeltStatements — so a transient failure can
// never wipe out that candidate's previously attached gdelt statements.
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
import { inferIssueSlugs } from '../../src/lib/issue-keywords';
import { HTML_NOISE_SELECTORS } from './_html';

/** Fixture-only marker (never written to the DB — see file header). Used
 * both to tag rows this ingester writes and to find-and-replace them on
 * the next run without touching rows from other ingesters. */
export const GDELT_DATA_SOURCE = 'gdelt';

const DEFAULT_MAX_ARTICLES_PER_CANDIDATE = 8;
const MIN_STATEMENT_TEXT_LEN = 20;
const MAX_STATEMENT_TEXT_LEN = 500;
const SOURCE_QUALITY = 65; // between fetch_statements.ts's 60 (unverified scrape) and the old NewsAPI ingester's 70 (Haiku-summarized)
const MAX_ISSUE_SLUGS = 3;

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

/**
 * Extract body paragraph text from article HTML. Generic news outlets
 * (not bespoke campaign sites), so this deliberately just joins every
 * <p> — no article/press-release-specific selectors like
 * fetch_statements.ts uses for campaign sites. Shares HTML_NOISE_SELECTORS
 * with fetch_campaign_site.ts's extractMainText so the two scrapers can't
 * drift apart on what counts as page noise (script/style/nav/footer/
 * header/aside/form — 'form' specifically strips cookie-consent and
 * newsletter-signup boilerplate that would otherwise leak into the
 * extracted text).
 */
export function extractArticleText(html: string): string {
  const $ = cheerio.load(html);
  $(HTML_NOISE_SELECTORS).remove();
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
 * Case-insensitive, whitespace-flexible regex for a candidate's name,
 * used only to find a natural center point for the excerpt below.
 * Matching DISCIPLINE (whether to attach at all) is entirely
 * nameAppearsIn()'s job; this regex intentionally does not re-implement
 * nameAppearsIn's diacritic/punctuation normalization — it only needs to
 * line up well enough, on the common case, that the excerpt doesn't open
 * mid-sentence. Falls back to the start of the text when it can't find an
 * exact-enough span (e.g. a diacritic in the name that this looser regex
 * doesn't tolerate but the normalized nameAppearsIn() check did).
 */
function buildNameSpanRegex(candidateName: string): RegExp {
  const words = candidateName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(words.join('\\s+'), 'i');
}

/**
 * Build a statement excerpt from fetched article text, centered on the
 * candidate's name when buildNameSpanRegex() can locate it. Returns null
 * when there isn't enough text to form a real statement
 * (MIN_STATEMENT_TEXT_LEN) — callers must drop, never fall back to the
 * GDELT index snippet.
 */
export function excerptAroundName(text: string, candidateName: string): string | null {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length < MIN_STATEMENT_TEXT_LEN) return null;
  const match = buildNameSpanRegex(candidateName).exec(trimmed);
  const start = match ? Math.max(0, match.index - 80) : 0;
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
  let totalSearchFailed = 0;

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
      // A failed search is NOT a confirmed zero-article result. Treating
      // it as zero and running the stale-data replacement below would
      // delete every previously attached gdelt statement for this
      // candidate on a transient failure, and the next seed run would
      // propagate that deletion to production. Skip the candidate
      // entirely — leave whatever statements it already has (from this
      // ingester or any other) completely untouched.
      totalSearchFailed++;
      console.warn(
        `[gdelt] ${name}: search failed — leaving existing statements untouched —`,
        err instanceof Error ? err.message : err,
      );
      continue;
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

      // Body match required — the GDELT title alone is not proof the
      // article is about this candidate (see file header).
      if (!nameAppearsIn(name, text)) {
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
        statement_date: article.seenDate, // may be null on a seendate format drift — see gdelt.ts's seenDateToIso
        context: 'news',
        issue_slugs: inferIssueSlugs(`${article.title} ${text}`, MAX_ISSUE_SLUGS),
        source_url: article.url,
        source_quality: SOURCE_QUALITY,
        data_source: GDELT_DATA_SOURCE,
      });
    }

    // Stale-data rule: replace only this ingester's own prior rows. Only
    // reached when the search itself succeeded (even with zero articles,
    // or every article dropped) — a confirmed empty result is safe to
    // write as an empty gdelt slice.
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
      `(no unambiguous match), ${totalDroppedFetchFailed} dropped (article fetch failed), ` +
      `${totalSearchFailed} candidate(s) skipped (search failed, existing statements untouched)`,
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
