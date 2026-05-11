// Fetch recent public statements from candidate campaign websites.
// Best-effort: campaign sites use bespoke layouts so this is heuristic.
// For broader coverage, layer in a news API (NewsAPI, Mediastack) — that
// requires a paid key and is deferred to Phase 2C.
//
// Usage:
//   npx tsx scripts/ingest/fetch_statements.ts --race-id race-nj-07-r-2026

import '../_env';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { fetchCachedText } from '../../src/lib/api-clients/base';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';

const MAX_STATEMENTS_PER_CANDIDATE = 5;

interface Args {
  raceId: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
  }
  if (!raceId) {
    console.error('Usage: --race-id "..."');
    process.exit(1);
  }
  return { raceId };
}

async function main() {
  const { raceId } = parseArgs();
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`Partial fixture missing: ${partialPath}`);
    process.exit(1);
  }
  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const candidates: Array<Record<string, unknown> & {
    name?: string;
    campaign_website?: string | null;
  }> = fixture.candidates ?? [];

  for (const c of candidates) {
    if (!c.name || !c.campaign_website) continue;
    const url = c.campaign_website;
    if (!url.startsWith('http')) continue;

    try {
      const html = await fetchCachedText(url, { cacheTag: `campaign:${url}` });
      const statements = extractStatements(html, url);
      c.statements = statements.slice(0, MAX_STATEMENTS_PER_CANDIDATE);
      console.log(`[statements] ${c.name}: ${c.statements?.length ?? 0} statements from ${url}`);
    } catch (err) {
      console.warn(`[statements] ${c.name} (${url}):`, err instanceof Error ? err.message : err);
      c.statements = [];
    }
  }

  writeFileSync(partialPath, JSON.stringify(fixture, null, 2));
  console.log(`[statements] wrote ${partialPath}`);
}

interface RawStatement {
  statement_text: string;
  statement_date: string | null;
  context: 'press_release' | 'campaign_video' | 'op_ed' | 'speech' | 'interview';
  source_url: string;
  issue_slugs: string[];
  source_quality: number;
}

/**
 * Extract press release headlines + first paragraphs from a campaign site.
 * Heuristic — looks for /press, /news, /blog links and pulls excerpts.
 */
export function extractStatements(html: string, baseUrl: string): RawStatement[] {
  const $ = cheerio.load(html);
  const statements: RawStatement[] = [];

  // Look for blog/news/press lists
  $('article, .post, .news-item, .press-release').each((_, el) => {
    const heading = $(el).find('h1, h2, h3').first().text().trim();
    const para = $(el).find('p').first().text().trim();
    const text = `${heading}. ${para}`.trim();
    if (text.length < 30) return;
    statements.push({
      statement_text: text.slice(0, 400),
      statement_date: extractDate($(el).text()),
      context: 'press_release',
      source_url: baseUrl,
      issue_slugs: [],
      source_quality: 60,
    });
  });

  return statements;
}

function extractDate(text: string): string | null {
  // Match ISO date or "Month DD, YYYY" patterns
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const monthDay = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/i
  );
  if (monthDay) {
    const months: Record<string, string> = {
      january: '01', february: '02', march: '03', april: '04', may: '05',
      june: '06', july: '07', august: '08', september: '09', october: '10',
      november: '11', december: '12',
    };
    const m = months[monthDay[1].toLowerCase()];
    if (m) return `${monthDay[3]}-${m}-${monthDay[2].padStart(2, '0')}`;
  }
  return null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
