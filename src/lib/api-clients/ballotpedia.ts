// Ballotpedia client — scrapes candidate pages for "Key Messages" + bio.
//
// No public API on the free tier. Cheerio-based HTML scraping; the cache
// layer in base.ts ensures we hit each page exactly once.
//
// Docs: https://ballotpedia.org/Help:Special_pages
// Risk: HTML changes break the parser. Snapshot tests recommended for
// the most-used selectors. See plan §11 risk row "web scraping breaks".

import * as cheerio from 'cheerio';
import { fetchBrowserCachedText } from './base';

// Ballotpedia sits behind Cloudflare; a plain HTTP fetch returns a 202
// "Just a moment..." page. fetchBrowserCachedText renders via Playwright
// and clears the JS challenge. Cache is shared with fetchCached on disk.
// Use a bp-v2 cacheTag prefix so any prior 202-stub cache entries from the
// older fetch path are bypassed (those had empty bodies).

export interface BallotpediaCandidate {
  name: string;
  ballotpedia_url: string;
  bio: string | null;
  party: string | null;
  office: string | null;
  campaign_website: string | null;
  key_messages: string[];
  /** Each key message attached to a topic if Ballotpedia categorized it */
  campaign_themes: Array<{ heading: string; text: string }>;
}

/**
 * Fetch a Ballotpedia candidate page and parse the structured content we
 * care about: bio, key messages, campaign themes, links.
 *
 * @param slug e.g. "Thomas_Kean_Jr."
 */
export async function getCandidate(slug: string): Promise<BallotpediaCandidate | null> {
  const url = `https://ballotpedia.org/${encodeURIComponent(slug)}`;
  const html = await fetchBrowserCachedText(url, { cacheTag: `bp-v2-candidate:${slug}` });
  return parseCandidate(html, url);
}

/**
 * Parse a Ballotpedia candidate page from its HTML. Exported for snapshot
 * testing without network calls.
 */
export function parseCandidate(html: string, url: string): BallotpediaCandidate | null {
  const $ = cheerio.load(html);

  // Title is in #firstHeading
  const name = $('#firstHeading').text().trim();
  if (!name) return null;

  // Infobox table rows: "Party:", "Campaign website:", etc.
  const infoboxRows = $('.infobox-political tr');
  const infoboxData: Record<string, string> = {};
  infoboxRows.each((_, tr) => {
    const label = $(tr).find('th').first().text().trim().replace(':', '').toLowerCase();
    const value = $(tr).find('td').first().text().trim();
    if (label) infoboxData[label] = value;
  });

  // Bio: first paragraph after the lead
  const bio = $('.mw-parser-output > p').first().text().trim() || null;

  // Campaign themes / Key messages: typically under
  // <h2>Key messages</h2> or <h2>Campaign themes</h2>. Walk the headings.
  const campaignThemes: Array<{ heading: string; text: string }> = [];
  const keyMessages: string[] = [];
  $('h2, h3').each((_, h) => {
    const heading = $(h).text().trim().toLowerCase();
    if (
      /key messages|campaign themes|campaign issues|priorities/i.test(heading)
    ) {
      // Capture sibling content until the next h2/h3
      let node = $(h).next();
      while (node.length && !/^h[23]$/i.test(node.prop('tagName') ?? '')) {
        const text = node.text().trim();
        if (text) {
          campaignThemes.push({ heading: $(h).text().trim(), text });
          // Also extract bullet items
          node.find('li').each((_i, li) => {
            const t = $(li).text().trim();
            if (t) keyMessages.push(t);
          });
        }
        node = node.next();
      }
    }
  });

  return {
    name,
    ballotpedia_url: url,
    bio,
    party: infoboxData.party ?? null,
    office: infoboxData.office ?? null,
    campaign_website:
      infoboxData['campaign website'] ??
      infoboxData.website ??
      $('a:contains("Campaign website")').first().attr('href') ??
      null,
    key_messages: keyMessages,
    campaign_themes: campaignThemes,
  };
}

/**
 * Find Ballotpedia candidate slugs for a race page. e.g.
 *   https://ballotpedia.org/U.S._House_New_Jersey_District_7_election,_2026_(Republican_primary)
 *
 * Returns the slug suffix used by getCandidate().
 */
export async function getCandidatesForRace(racePageSlug: string): Promise<string[]> {
  const url = `https://ballotpedia.org/${encodeURIComponent(racePageSlug)}`;
  const html = await fetchBrowserCachedText(url, { cacheTag: `bp-v2-race:${racePageSlug}` });
  const $ = cheerio.load(html);
  const slugs = new Set<string>();
  // Candidates are usually linked from the "Candidates" section's table or list
  $('a[href^="/"]').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    if (!href.startsWith('/')) return;
    if (/^\/(Special|File|Help|Category|Wikipedia|Talk):/i.test(href)) return;
    if (/wikipedia/i.test(href)) return;
    // Heuristic: a link with at least "FirstLast" formatting is a candidate page
    const slug = href.slice(1);
    if (/^[A-Z][A-Za-z]+(_[A-Z][A-Za-z.]+)+$/.test(slug)) {
      slugs.add(slug);
    }
  });
  return Array.from(slugs);
}
