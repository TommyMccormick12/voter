// Wikipedia client — bio, infobox campaign URL, and "Political positions"
// section text. Wikipedia is bot-friendly (no Cloudflare), has structured
// data for major candidates, and serves as our primary platform-data source
// after OpenSecrets, FollowTheMoney, Ballotpedia, and ProPublica all
// retired or gated their APIs.
//
// Docs: https://en.wikipedia.org/api/rest_v1/
// Auth: none required, but send a polite User-Agent.
// Rate limit: ~200 calls/sec from a single IP per Wikipedia's etiquette
// guidelines. We're well under that with fetchCached throttle.

import * as cheerio from 'cheerio';
import { fetchCached } from './base';

const BASE = 'https://en.wikipedia.org/wiki';

export interface WikipediaCandidate {
  url: string;
  found: boolean;
  /** First substantive paragraph — used as bio fallback when Ballotpedia is empty. */
  lead_paragraph: string;
  /** Campaign / official website from the infobox, if present. */
  website: string | null;
  /** Raw text of the "Political positions" section, if present. ~5-30K chars typical. */
  political_positions_text: string | null;
  /** Section headings under "Political positions" (e.g., "Economy", "Foreign policy"). */
  political_subsections: string[];
}

/**
 * Fetch a Wikipedia page for a person and extract the slices we care about.
 * Returns { found: false, ... } when the page doesn't exist or is a
 * disambiguation page. Caller decides whether to skip or try alternate slugs.
 */
export async function getWikipediaCandidate(
  fullName: string,
): Promise<WikipediaCandidate> {
  const slug = fullName.trim().replace(/\s+/g, '_');
  const url = `${BASE}/${encodeURIComponent(slug)}`;

  let html: string;
  try {
    const wrapper = await fetchCached<{ body?: string }>(url, {
      cacheTag: `wiki:${slug}`,
      headers: { 'User-Agent': 'voter-app/0.4 (campaign-finance research)' },
    });
    html = wrapper && typeof wrapper.body === 'string' ? wrapper.body : '';
  } catch {
    return emptyResult(url);
  }

  const $ = cheerio.load(html);
  const title = $('h1#firstHeading').text().trim();
  if (!title) return emptyResult(url);

  // Disambiguation pages have "may refer to:" in the lead — skip them.
  const firstP = $('#mw-content-text p')
    .filter((_, p) => $(p).text().trim().length > 30)
    .first()
    .text()
    .replace(/\[\d+\]/g, '')
    .trim();
  if (/may refer to:/i.test(firstP.slice(0, 200))) return emptyResult(url);

  // Infobox website — typically an external link in the .infobox table
  const website = findInfoboxWebsite($);

  // "Political positions" section — walk siblings between that h2 and the
  // next h2. Section headers in Wikipedia use h2/h3 for subsections.
  const { text, subsections } = extractSection($, 'Political positions');

  return {
    url,
    found: true,
    lead_paragraph: firstP.slice(0, 600),
    website,
    political_positions_text: text,
    political_subsections: subsections,
  };
}

function emptyResult(url: string): WikipediaCandidate {
  return {
    url,
    found: false,
    lead_paragraph: '',
    website: null,
    political_positions_text: null,
    political_subsections: [],
  };
}

function findInfoboxWebsite($: cheerio.CheerioAPI): string | null {
  // Wikipedia infoboxes vary; the official site link is usually an
  // external link inside the infobox. Look for typical patterns.
  const candidates: string[] = [];
  $('.infobox a.external').each((_, a) => {
    const href = $(a).attr('href');
    if (href) candidates.push(href);
  });
  // Prefer .house.gov or .senate.gov (official) over campaign sites for now
  const official = candidates.find((u) =>
    /\.house\.gov\/?$|\.senate\.gov\/?$/.test(u),
  );
  return official ?? candidates[0] ?? null;
}

function extractSection(
  $: cheerio.CheerioAPI,
  sectionTitle: string,
): { text: string | null; subsections: string[] } {
  // Modern Wikipedia (2023+) wraps each section header in:
  //   <div class="mw-heading mw-heading2"><h2 id="...">Title</h2></div>
  //   <p>...content...</p>
  //   <div class="mw-heading mw-heading3"><h3>Subsection</h3></div>
  // So we need to find the h2, walk UP to its mw-heading wrapper, then
  // walk SIBLINGS starting from that wrapper's next() until we hit the
  // next mw-heading2 wrapper. Falls back to plain-h2 walking for older
  // page versions.
  const article = $('#mw-content-text');
  const titleLower = sectionTitle.toLowerCase();
  let targetWrapper: cheerio.Cheerio<import('domhandler').AnyNode> | null = null;

  article.find('h2').each((_, h) => {
    const text = $(h).text().replace(/\[edit\]/gi, '').trim().toLowerCase();
    if (text.startsWith(titleLower)) {
      const wrapper = $(h).closest('.mw-heading2');
      targetWrapper = wrapper.length > 0 ? wrapper : $(h);
      return false;
    }
  });

  if (!targetWrapper) return { text: null, subsections: [] };

  const subsections: string[] = [];
  const chunks: string[] = [];
  let node = (targetWrapper as cheerio.Cheerio<import('domhandler').AnyNode>).next();
  while (node.length > 0) {
    // Stop at the next top-level section header
    if (
      node.hasClass('mw-heading2') ||
      node.prop('tagName') === 'H2'
    ) {
      break;
    }

    // Capture subsection labels (mw-heading3 wrappers OR plain h3/h4)
    if (node.hasClass('mw-heading3') || node.hasClass('mw-heading4')) {
      subsections.push(
        node.text().replace(/\[edit\]/gi, '').replace(/\s+/g, ' ').trim(),
      );
    } else if (node.prop('tagName') === 'H3' || node.prop('tagName') === 'H4') {
      subsections.push(node.text().replace(/\[edit\]/gi, '').trim());
    }

    const text = node
      .text()
      .replace(/\[\d+\]/g, '')         // strip citation markers
      .replace(/\[edit\]/gi, '')        // strip edit links
      .replace(/\s+/g, ' ')             // collapse whitespace
      .trim();
    if (text) chunks.push(text);
    node = node.next();
  }

  const text = chunks.join('\n\n').trim();
  return { text: text || null, subsections };
}
