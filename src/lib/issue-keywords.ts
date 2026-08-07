// Shared heuristic keyword -> issue-slug table for pipeline ingesters that
// tag free text (bill titles, article text) against the 10-issue taxonomy
// in issues.ts.
//
// One shared table so scripts/ingest/fetch_votes.ts and
// scripts/ingest/fetch_gdelt_statements.ts can't drift apart on which
// keywords map to which slug (2026-08-07 review finding: fetch_gdelt_
// statements.ts's private copy had silently dropped the 'taxes' entry
// below).
//
// Deliberately conservative — better to miss a tag than to mis-tag, since
// these feed Haiku synthesis.

import { ISSUE_NAMES } from './issues';

export const ISSUE_KEYWORDS: Array<[RegExp, keyof typeof ISSUE_NAMES]> = [
  [/tax|jobs and economic|economy|wage/i, 'economy'],
  [/health|medicare|medicaid|aca|prescription/i, 'healthcare'],
  [/immigration|border|asylum|deport/i, 'immigration'],
  [/climate|emission|clean energy|epa|fossil/i, 'climate'],
  [/education|student loan|school|teacher/i, 'education'],
  [/firearm|gun|second amendment/i, 'guns'],
  [/criminal justice|prison|sentencing|police/i, 'criminal_justice'],
  [/foreign|ukraine|israel|china|nato|military|defense/i, 'foreign_policy'],
  [/tax cut|tcja/i, 'taxes'],
  [/housing|rent|mortgage|hud/i, 'housing'],
];

/**
 * Match `text` against ISSUE_KEYWORDS in order, returning up to `max`
 * slugs (default unlimited — fetch_votes.ts relies on getting every
 * matching slug for a bill title/summary, uncapped). Pass max=3 for
 * callers (e.g. fetch_gdelt_statements.ts) that want a bounded tag count.
 */
export function inferIssueSlugs(text: string, max: number = Infinity): string[] {
  const slugs: string[] = [];
  for (const [re, slug] of ISSUE_KEYWORDS) {
    if (slugs.length >= max) break;
    if (re.test(text)) slugs.push(slug);
  }
  return slugs;
}
