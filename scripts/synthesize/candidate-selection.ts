// Pure, side-effect-free selection of which fixture candidates a synthesis
// run touches.
//
// Lives in its own module for the same reason scripts/seed/candidate-website.ts
// and scripts/review/activation-gate.ts do: synthesize_stances.ts calls main()
// at import, so a rule that only lives there cannot be unit-tested without
// running a real synthesis against the LLM.
//
// Consumers:
//   - scripts/synthesize/synthesize_stances.ts
//   - tests/candidate-selection.test.ts

export interface SelectableCandidate {
  name?: string;
  slug?: string;
  [key: string]: unknown;
}

export interface Selection<T> {
  /** The candidates this run will synthesize. */
  selected: T[];
  /** Every other candidate in the fixture. The run must not touch these. */
  skipped: T[];
}

/**
 * Derive the slug a candidate is stored under.
 *
 * `synthesize_stances.ts` writes `c.slug ?? slugify(c.name)` back onto the
 * fixture, so the effective slug is the same value whether the fixture
 * carries one or not. Selection has to use that same value, otherwise
 * `--only-slug` and the fixture disagree about what a candidate is called.
 *
 * Note the explicit `slug` field wins: it comes from the FEC legal name,
 * which is often not the display name (Eddie Speir is `jason-edward-speir`).
 */
export function effectiveSlug(c: SelectableCandidate): string {
  const explicit = c.slug;
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim();
  return slugify(typeof c.name === 'string' ? c.name : '');
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Split a race fixture into the candidates a run synthesizes and the ones it
 * leaves alone.
 *
 * Without `onlySlug` the run is race-wide, which is the historical behaviour.
 *
 * With `onlySlug` it selects exactly the one candidate carrying that slug.
 * This used to compare against `ballotpedia_slug`, a field no candidate in
 * the fixtures carries, so the flag matched nobody and every run had to go
 * race-wide — regenerating stances for candidates who were already live and
 * leaving a human diff as the only protection.
 *
 * An unmatched slug throws. A run that reports success having synthesized
 * nobody is the failure mode that hid the original bug for so long, so the
 * error names every slug the fixture does carry.
 */
export function selectForSynthesis<T extends SelectableCandidate>(
  candidates: T[],
  onlySlug?: string,
): Selection<T> {
  const wanted = onlySlug?.trim();
  if (!wanted) return { selected: [...candidates], skipped: [] };

  const selected: T[] = [];
  const skipped: T[] = [];
  for (const c of candidates) {
    if (effectiveSlug(c) === wanted) selected.push(c);
    else skipped.push(c);
  }

  if (selected.length === 0) {
    const available = candidates.map((c) => effectiveSlug(c)).filter(Boolean);
    throw new Error(
      `--only-slug "${wanted}" matches no candidate in this race. ` +
        (available.length
          ? `Available slugs: ${available.join(', ')}`
          : 'This fixture holds no named candidates.'),
    );
  }

  return { selected, skipped };
}
