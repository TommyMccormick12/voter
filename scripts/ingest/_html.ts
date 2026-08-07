// Shared HTML-noise-stripping helper for pipeline scripts that scrape
// candidate-adjacent pages (campaign sites, news articles) with cheerio.
//
// Kept in one place so fetch_campaign_site.ts and fetch_gdelt_statements.ts
// can't drift out of sync on which non-content elements to strip before
// extracting text (2026-08-07 review finding: fetch_gdelt_statements.ts's
// private copy of this list had silently dropped 'form', letting
// cookie-consent/newsletter-signup boilerplate leak into extracted article
// text and get attached as a candidate "statement").

/** Selector list for cheerio's `.remove()` before pulling text — nav,
 * scripts/styles, and forms (cookie-consent banners, newsletter signup,
 * search boxes) are never real page content. */
export const HTML_NOISE_SELECTORS = 'script, style, nav, footer, header, aside, form';
