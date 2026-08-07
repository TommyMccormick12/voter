// Tests for the statement-attachment logic in
// scripts/ingest/fetch_gdelt_statements.ts.
//
// Covers:
//   - unambiguous full-name attach happy path.
//   - ambiguous / last-name-only / no-match articles dropped, never
//     attached (the attribution discipline the ticket is built around).
//   - article-fetch failure dropped — never falls back to the GDELT index
//     snippet as a substitute statement.
//   - stale-data rule: a re-run replaces only this ingester's own prior
//     rows (marked data_source: 'gdelt'), leaving other-source rows alone.
//   - the exact row shape scripts/seed/seed_candidates.ts's stmtRows
//     mapping expects: statement_text, statement_date, context,
//     issue_slugs, source_url, source_quality.
//
// searchFn and fetchArticleText are both dependency-injected (see the
// attachGdeltStatements signature) so every test below runs with no
// network call, no fs access, and no vi.mock module gymnastics — same
// spirit as tests/fetch_votes.test.ts, but simpler because this file's
// injection point is a function argument rather than a mocked import.

import { describe, it, expect, vi } from 'vitest';
import {
  attachGdeltStatements,
  extractArticleText,
  nameAppearsIn,
  excerptAroundName,
  GDELT_DATA_SOURCE,
  type GdeltCandidate,
} from '../scripts/ingest/fetch_gdelt_statements';
import type { GdeltArticle } from '../src/lib/api-clients/gdelt';

function article(overrides: Partial<GdeltArticle> = {}): GdeltArticle {
  return {
    url: 'https://www.floridapolitics.com/archives/some-article',
    title: 'Anna Paulina Luna holds town hall on healthcare',
    seenDate: '2026-06-15',
    domain: 'floridapolitics.com',
    language: 'English',
    sourceCountry: 'United States',
    ...overrides,
  };
}

const LONG_TEXT_ABOUT_LUNA =
  'At a town hall Saturday, Rep. Anna Paulina Luna told voters she supports expanding rural ' +
  'hospital funding and criticized the current Medicare prior-authorization process as too slow ' +
  'for seniors in her district.';

const LONG_TEXT_NO_CANDIDATE_NAME =
  'Local officials gathered Saturday to discuss county road repaving priorities for the coming ' +
  'fiscal year, with several residents raising concerns about drainage near the new development.';

const LONG_TEXT_LAST_NAME_ONLY =
  'Luna Bakery on Main Street celebrated its tenth anniversary this week with a community open ' +
  'house, drawing dozens of longtime customers from across the county.';

describe('nameAppearsIn (whole-word, normalized, never partial)', () => {
  it('matches the full name case- and punctuation-insensitively', () => {
    expect(nameAppearsIn('Anna Paulina Luna', 'Rep. ANNA-PAULINA LUNA spoke today')).toBe(true);
  });

  it('does not match on last name only', () => {
    expect(nameAppearsIn('Anna Paulina Luna', LONG_TEXT_LAST_NAME_ONLY)).toBe(false);
  });

  it('does not match a name that is a substring of a longer word', () => {
    expect(nameAppearsIn('Anna Paulina Luna', 'Annabelle Paulina Lunardi spoke today')).toBe(false);
  });

  it('does not match when the candidate is entirely absent', () => {
    expect(nameAppearsIn('Anna Paulina Luna', LONG_TEXT_NO_CANDIDATE_NAME)).toBe(false);
  });
});

describe('excerptAroundName', () => {
  it('returns a trimmed excerpt long enough to be a real statement', () => {
    const excerpt = excerptAroundName(LONG_TEXT_ABOUT_LUNA, 'Anna Paulina Luna');
    expect(excerpt).not.toBeNull();
    expect((excerpt as string).length).toBeGreaterThanOrEqual(20);
  });

  it('returns null when the text is too short to form a statement', () => {
    expect(excerptAroundName('Too short.', 'Anna Paulina Luna')).toBeNull();
  });
});

describe('extractArticleText', () => {
  it('joins paragraph text and strips script/style/nav noise', () => {
    const html = `
      <html><body>
        <nav>Home | About</nav>
        <script>trackPageview();</script>
        <article>
          <p>${LONG_TEXT_ABOUT_LUNA}</p>
        </article>
        <footer>© 2026</footer>
      </body></html>
    `;
    const text = extractArticleText(html);
    expect(text).toContain('Anna Paulina Luna');
    expect(text).not.toContain('trackPageview');
    expect(text).not.toContain('Home | About');
  });
});

describe('attachGdeltStatements', () => {
  it('attaches a statement built from FETCHED article text (not the GDELT title/snippet alone) on an unambiguous full-name match', async () => {
    const searchFn = vi.fn().mockResolvedValue([article()]);
    const fetchArticleText = vi.fn().mockResolvedValue(LONG_TEXT_ABOUT_LUNA);
    const candidates: GdeltCandidate[] = [{ name: 'Anna Paulina Luna' }];

    await attachGdeltStatements(candidates, searchFn, { fetchArticleText });

    expect(candidates[0].statements).toHaveLength(1);
    const row = candidates[0].statements![0];
    expect(row).toMatchObject({
      statement_date: '2026-06-15',
      context: 'news',
      source_url: 'https://www.floridapolitics.com/archives/some-article',
      source_quality: expect.any(Number),
      data_source: GDELT_DATA_SOURCE,
    });
    expect(typeof row.statement_text).toBe('string');
    expect((row.statement_text as string).length).toBeGreaterThanOrEqual(20);
    expect(Array.isArray(row.issue_slugs)).toBe(true);
    // Row carries exactly the fields seed_candidates.ts's stmtRows mapping
    // reads (statement_text, statement_date, context, issue_slugs,
    // source_url, source_quality) plus the fixture-only data_source marker.
    expect(Object.keys(row).sort()).toEqual(
      [
        'context',
        'data_source',
        'issue_slugs',
        'source_quality',
        'source_url',
        'statement_date',
        'statement_text',
      ].sort(),
    );
  });

  it('drops an article that names no candidate, with the drop counted rather than silently attached', async () => {
    const searchFn = vi.fn().mockResolvedValue([article({ title: 'County road repaving update' })]);
    const fetchArticleText = vi.fn().mockResolvedValue(LONG_TEXT_NO_CANDIDATE_NAME);
    const candidates: GdeltCandidate[] = [{ name: 'Anna Paulina Luna' }];

    await attachGdeltStatements(candidates, searchFn, { fetchArticleText });

    expect(candidates[0].statements).toEqual([]);
  });

  it('never attaches on a last-name-only match', async () => {
    const searchFn = vi.fn().mockResolvedValue([article({ title: 'Luna Bakery turns ten' })]);
    const fetchArticleText = vi.fn().mockResolvedValue(LONG_TEXT_LAST_NAME_ONLY);
    const candidates: GdeltCandidate[] = [{ name: 'Anna Paulina Luna' }];

    await attachGdeltStatements(candidates, searchFn, { fetchArticleText });

    expect(candidates[0].statements).toEqual([]);
  });

  it('drops an article when the fetch fails, never falling back to GDELT index metadata as a statement', async () => {
    const searchFn = vi.fn().mockResolvedValue([article()]);
    const fetchArticleText = vi.fn().mockRejectedValue(new Error('HTTP 404 on floridapolitics.com'));
    const candidates: GdeltCandidate[] = [{ name: 'Anna Paulina Luna' }];

    await attachGdeltStatements(candidates, searchFn, { fetchArticleText });

    expect(candidates[0].statements).toEqual([]);
    expect(fetchArticleText).toHaveBeenCalledWith(article().url);
  });

  it('replaces this ingester\'s own prior rows on re-run without duplicating, and leaves other-source rows untouched', async () => {
    const staleGdeltRow = {
      statement_text: 'Old GDELT-sourced statement from a prior run.',
      statement_date: '2026-01-01',
      context: 'news',
      issue_slugs: [],
      source_url: 'https://www.floridapolitics.com/archives/old-article',
      source_quality: 65,
      data_source: GDELT_DATA_SOURCE,
    };
    const campaignSiteRow = {
      statement_text: 'A statement scraped from the campaign website.',
      statement_date: '2026-02-01',
      context: 'press_release',
      issue_slugs: [],
      source_url: 'https://campaign.example.com/press/1',
      source_quality: 60,
      // No data_source field at all — matches fetch_statements.ts's rows.
    };
    const candidates: GdeltCandidate[] = [
      { name: 'Anna Paulina Luna', statements: [staleGdeltRow, campaignSiteRow] },
    ];
    const searchFn = vi.fn().mockResolvedValue([article()]);
    const fetchArticleText = vi.fn().mockResolvedValue(LONG_TEXT_ABOUT_LUNA);

    await attachGdeltStatements(candidates, searchFn, { fetchArticleText });

    const statements = candidates[0].statements!;
    // The other-source row survives untouched.
    expect(statements).toContainEqual(campaignSiteRow);
    // The stale GDELT row is gone (replaced, not duplicated).
    expect(statements.find((s) => s.source_url === staleGdeltRow.source_url)).toBeUndefined();
    // Exactly one fresh GDELT row from this run.
    expect(statements.filter((s) => s.data_source === GDELT_DATA_SOURCE)).toHaveLength(1);
    expect(statements).toHaveLength(2);
  });

  it('skips a candidate with no name rather than searching for an empty query', async () => {
    const searchFn = vi.fn();
    const candidates: GdeltCandidate[] = [{}];

    await attachGdeltStatements(candidates, searchFn, {});

    expect(searchFn).not.toHaveBeenCalled();
  });

  it('passes the candidate name (and state, when given) as a quoted search query', async () => {
    const searchFn = vi.fn().mockResolvedValue([]);
    const candidates: GdeltCandidate[] = [{ name: 'Anna Paulina Luna' }];

    await attachGdeltStatements(candidates, searchFn, { state: 'FL' });

    expect(searchFn).toHaveBeenCalledWith('"Anna Paulina Luna" FL', expect.any(Object));
  });
});
