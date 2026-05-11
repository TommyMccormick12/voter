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
 * Returns the slug suffix used by getCandidate(). Returns an empty array
 * when the page is a MediaWiki "noarticletext" stub (the page URL is valid
 * but Ballotpedia hasn't created article content yet, which is common for
 * federal primary subpages early in the cycle).
 */
export async function getCandidatesForRace(racePageSlug: string): Promise<string[]> {
  const url = `https://ballotpedia.org/${encodeURIComponent(racePageSlug)}`;
  const html = await fetchBrowserCachedText(url, { cacheTag: `bp-v2-race:${racePageSlug}` });
  const $ = cheerio.load(html);

  // Stub detection. If the page is empty, the all-`<a>` scan below would
  // pick up Ballotpedia's site nav (Main_Page, Federal_Politics, ...) and
  // mis-classify those as candidates. Short-circuit cleanly.
  const isStub =
    $('.noarticletext').length > 0 ||
    /This page does not have an article yet|noarticletext/i.test(html);
  if (isStub) {
    console.log(`[ballotpedia] page ${racePageSlug} is a stub — no candidates available`);
    return [];
  }

  // Scope to the actual article body (#mw-content-text) and prefer links
  // that appear inside the "Candidates" section. If the page structure
  // shifts, fall back to scanning all article-body links with a stricter
  // anti-nav filter.
  const slugs = new Set<string>();
  const article = $('#mw-content-text');
  const candidatesHeader = article
    .find('h2 .mw-headline')
    .filter((_, e) => /^Candidates/i.test($(e).text()))
    .first();

  let scope = article.find('a[href^="/"]');
  if (candidatesHeader.length > 0) {
    // Limit to elements between the Candidates h2 and the next h2.
    const containers: ReturnType<typeof $> = $();
    let node = candidatesHeader.closest('h2').next();
    while (node.length > 0 && node.prop('tagName') !== 'H2') {
      containers.add(node);
      node = node.next();
    }
    scope = containers.find('a[href^="/"]');
  }

  scope.each((_, a) => {
    const href = $(a).attr('href') ?? '';
    if (!href.startsWith('/')) return;
    if (/^\/(Special|File|Help|Category|Wikipedia|Talk|Ballotpedia|Survey):/i.test(href)) return;
    if (/wikipedia/i.test(href)) return;
    // Drop clearly-non-candidate Ballotpedia portal pages
    const slug = href.slice(1).split('#')[0].split('?')[0];
    if (/^(Main_Page|Sample_Ballot_Lookup|Election_Policy|Ballot_Access|Federal_Politics|Executive_Branch|Legislative_Branch|Municipal_Government|Administrative_State|Public_Policy|Ballotpedia_Email_Updates)$/i.test(slug)) return;
    // Heuristic: candidate slug is FirstName_LastName, sometimes with a
    // middle name or suffix. Tighter than before — must look like a person.
    if (/^[A-Z][a-z]+(_[A-Z][a-z'.]+){1,4}$/.test(slug)) {
      slugs.add(slug);
    }
  });
  return Array.from(slugs);
}
