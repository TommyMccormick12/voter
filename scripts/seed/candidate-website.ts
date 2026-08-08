// Pure, side-effect-free resolution of a candidate's website from a fixture.
//
// Lives in its own module for the same reason scripts/review/activation-gate.ts
// does: seed_candidates.ts calls main() at import, so a rule that only lives
// there cannot be unit-tested without running a seed.
//
// Consumers:
//   - scripts/seed/seed_candidates.ts — the candidates.website column.
//   - tests/candidate-website.test.ts

/**
 * Resolve a candidate's site from a fixture, in the same precedence the
 * synthesizer uses.
 *
 * Different ingest paths write different field names for the same fact:
 * `fetch_ballotpedia.ts` writes `campaign_website`, `author_platform.ts`
 * writes `website`. Reading only one of them silently drops the other.
 * That exact mismatch already shipped once — `synthesize_stances.ts` read
 * only `campaign_website`, so every hand-authored candidate got stances
 * with no `source_url` (fixed 2026-08-08). This is the same seam on the
 * seeder, so the precedence is kept identical on purpose: a future field
 * addition must be made in both places or they drift apart again.
 *
 * An empty or whitespace-only string is not a site — it becomes NULL, the
 * honest "unknown", rather than a link to nowhere.
 */
export function candidateWebsite(c: Record<string, unknown>): string | null {
  for (const key of ['campaign_website', 'website', 'ballotpedia_url'] as const) {
    const value = c[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}
