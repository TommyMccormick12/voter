// The issue taxonomy: the topic buckets a stance, vote, or statement can be
// filed under.
//
// EXPANDED 2026-08-07 (Tommy's call). The original ten forced real candidate
// material into the wrong bucket, and verifiers refuted stances for it:
// Everglades/water-quality planks landed under `climate` on candidates who
// never mentioned climate change, and school-safety/policing planks landed
// under `criminal_justice`. The six additions below each come from material
// that appeared repeatedly across the 2026 FL field. Adding is safe; removing
// or renaming a slug is not (stances, votes, and statements store the slug),
// so treat this list as append-only.
//
// Adding a slug here does NOT add it to the voter questionnaire — that is
// TOP_5_ISSUES in src/app/match/page.tsx, deliberately kept short.
export const ISSUE_NAMES: Record<string, string> = {
  economy: 'Economy & Jobs',
  healthcare: 'Healthcare',
  immigration: 'Immigration',
  climate: 'Climate & Energy',
  education: 'Education',
  guns: 'Gun Policy',
  criminal_justice: 'Criminal Justice',
  foreign_policy: 'Foreign Policy',
  taxes: 'Taxes',
  housing: 'Housing',
  environment: 'Environment & Water',
  public_safety: 'Public Safety',
  veterans: 'Veterans',
  government_reform: 'Government Reform',
  reproductive_rights: 'Reproductive Rights',
  technology: 'Technology & AI',
  civil_rights: 'Civil Rights',
};

/** Every valid issue slug. Single source of truth for the prompts that ask a
 * model to pick one (src/lib/llm/curate.ts) — a taxonomy addition that does
 * not reach those prompts is invisible to the pipeline. */
export const ISSUE_SLUGS = Object.keys(ISSUE_NAMES);

/** Shorter labels for space-constrained surfaces (the carousel card). Only
 * slugs whose full label is too long need an entry; everything else falls
 * through to ISSUE_NAMES. */
const ISSUE_NAMES_SHORT: Record<string, string> = {
  economy: 'Economy',
  climate: 'Climate',
  guns: 'Guns',
  environment: 'Environment',
  government_reform: 'Govt Reform',
  reproductive_rights: 'Repro Rights',
  technology: 'Technology',
};

/** Display label for an issue slug. Falls back to the raw slug so an
 * unrecognized value degrades to something truthful rather than blank. */
export function issueLabel(slug: string): string {
  return ISSUE_NAMES[slug] ?? slug;
}

/** Display label for narrow surfaces. */
export function issueLabelShort(slug: string): string {
  return ISSUE_NAMES_SHORT[slug] ?? ISSUE_NAMES[slug] ?? slug;
}
