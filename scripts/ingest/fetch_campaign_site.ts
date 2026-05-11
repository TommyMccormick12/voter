// Pull a candidate's stated platform from their own campaign website
// (Phase 2D §16.3.b). Complements fetch_platform.ts which reads
// Wikipedia: this script targets challengers without Wikipedia coverage
// — the bulk of FL D-side primaries.
//
// Process per candidate (only if candidate.website is set):
//   1. Try the common platform URL patterns:
//        ${website}/issues, /platform, /priorities, /policy, /agenda,
//        /our-priorities, /policies
//   2. Playwright-render to clear Cloudflare/JS-only sites.
//   3. Strip the HTML to main-content text (heuristic — main, article,
//      role=main, or longest <section>).
//   4. Pass through the existing extractPlatform Haiku helper (same
//      10-issue taxonomy as Wikipedia path).
//   5. Merge `key_messages` + `campaign_themes` into the fixture so
//      synth:stances has input.
//
// Only fills in when fetch_platform.ts didn't already populate the data.
// The Wikipedia path is preferred (richer prose, NPOV); campaign-site is
// the fallback for candidates without Wikipedia coverage.
//
// Usage:
//   ANTHROPIC_API_KEY=... npx tsx scripts/ingest/fetch_campaign_site.ts \
//     --race-id race-fl-sen-d-2026

import '../_env';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'cheerio';
import {
  CANDIDATE_FIXTURE_DIR,
  fetchBrowserCachedText,
  closeBrowser,
} from '../../src/lib/api-clients/base';
import { extractPlatform } from '../../src/lib/llm/extract-platform';

interface Args {
  raceId: string;
  /** Force a re-extraction even if key_messages/campaign_themes already set. */
  force: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId = '';
  let force = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
    else if (args[i] === '--force') force = true;
  }
  if (!raceId) {
    console.error('Usage: --race-id "..." [--force]');
    process.exit(1);
  }
  return { raceId, force };
}

/**
 * URL paths to try for each candidate's campaign site, in priority order.
 * Stop at the first one that returns extractable text.
 */
const PLATFORM_PATHS = [
  '/issues',
  '/issues/',
  '/platform',
  '/platform/',
  '/priorities',
  '/our-priorities',
  '/policy',
  '/policies',
  '/agenda',
  '/where-i-stand',
];

/**
 * Extract the main-content text from a candidate's platform page. Tries
 * (in order) <main>, <article>, [role="main"], and falls back to the
 * longest <section>. Strips scripts, styles, and nav before extracting.
 */
function extractMainText(html: string): string {
  const $ = load(html);
  $('script, style, nav, footer, header, aside, form').remove();
  const candidates = [
    $('main').first(),
    $('article').first(),
    $('[role="main"]').first(),
  ];
  for (const c of candidates) {
    if (c.length > 0) {
      const txt = c.text().replace(/\s+/g, ' ').trim();
      if (txt.length > 200) return txt;
    }
  }
  // Fallback: longest <section>
  let best = '';
  $('section').each((_, el) => {
    const txt = $(el).text().replace(/\s+/g, ' ').trim();
    if (txt.length > best.length) best = txt;
  });
  if (best.length > 200) return best;
  // Last resort — full body, deduped whitespace
  return $('body').text().replace(/\s+/g, ' ').trim();
}

/**
 * Normalize a candidate.website to a base URL safe for concat with
 * platform paths. Strips trailing slash + any path the site provided.
 */
function siteOrigin(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

async function main() {
  const { raceId, force } = parseArgs();
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`[campaign-site] fixture missing: ${partialPath}`);
    process.exit(1);
  }

  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const candidates: Array<Record<string, unknown> & { name?: string; website?: string }> =
    fixture.candidates ?? [];

  let extractedCount = 0;
  for (const c of candidates) {
    if (!c.name || typeof c.name !== 'string') continue;
    if (!c.website && !c.campaign_website) {
      console.log(`[campaign-site] ${c.name}: no website — skipping`);
      continue;
    }
    const websiteRaw = (c.website ?? c.campaign_website) as string;
    const origin = siteOrigin(websiteRaw);
    if (!origin) {
      console.log(`[campaign-site] ${c.name}: invalid website "${websiteRaw}" — skipping`);
      continue;
    }

    // Skip if Wikipedia path already populated key_messages and we're not
    // re-running with --force.
    const hasExisting =
      Array.isArray(c.key_messages) && (c.key_messages as string[]).length > 0;
    if (hasExisting && !force) {
      console.log(`[campaign-site] ${c.name}: already has key_messages — skipping (use --force)`);
      continue;
    }

    let text: string | null = null;
    let sourceUrl = '';
    for (const path of PLATFORM_PATHS) {
      const url = `${origin}${path}`;
      try {
        const html = await fetchBrowserCachedText(url, { cacheTag: 'campaign-v1' });
        const mainText = extractMainText(html);
        if (mainText.length > 300) {
          text = mainText;
          sourceUrl = url;
          break;
        }
      } catch (err) {
        // 404 or browser error — try next path
        console.log(`[campaign-site] ${c.name}: ${url} → ${(err as Error).message}`);
      }
    }

    if (!text) {
      console.log(`[campaign-site] ${c.name}: no platform page found on ${origin}`);
      continue;
    }

    const result = await extractPlatform(c.name, text);
    if (result.positions.length === 0) {
      console.log(`[campaign-site] ${c.name}: ${sourceUrl} parsed but Haiku extracted 0 positions`);
      continue;
    }

    c.key_messages = result.positions.map((p) => p.summary);
    c.campaign_themes = result.positions.map((p) => ({
      heading: p.issue_slug,
      text: p.summary,
    }));
    c.platform_excerpts = result.positions.map((p) => ({
      issue_slug: p.issue_slug,
      excerpt: p.source_excerpt,
      source: 'campaign_site',
      source_url: sourceUrl,
    }));

    const callType =
      result.source === 'cache'
        ? '(cached)'
        : `(Haiku ${result.input_tokens ?? 0}/${result.output_tokens ?? 0} tok)`;
    console.log(
      `[campaign-site] ${c.name}: ${result.positions.length} positions from ${sourceUrl} ${callType}`,
    );
    console.log(`            issues: ${result.positions.map((p) => p.issue_slug).join(', ')}`);
    extractedCount++;
  }

  writeFileSync(partialPath, JSON.stringify(fixture, null, 2));
  console.log(`[campaign-site] wrote ${partialPath}. ${extractedCount} candidates extracted.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeBrowser());
