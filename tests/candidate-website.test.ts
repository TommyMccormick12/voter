// The seeder used to read only `campaign_website`, but `author_platform.ts`
// writes `website`. Every hand-authored candidate therefore reached the DB
// with website = NULL — 4 of the 93 active candidates at the time (Frankman,
// Speir, Liccione, Gimenez), all of them the ones whose site we had actually
// gone and found by hand.
//
// This is the second time the same field-name mismatch has bitten. The first
// was `synthesize_stances.ts`, which read only `campaign_website` and so gave
// every hand-authored candidate stances with no source_url. These tests pin
// the precedence so the two seams cannot drift apart again.

import { describe, it, expect } from 'vitest';
import { candidateWebsite } from '../scripts/seed/candidate-website';

describe('candidateWebsite', () => {
  it('reads campaign_website, the ballotpedia ingest field', () => {
    expect(candidateWebsite({ campaign_website: 'https://a.example' })).toBe('https://a.example');
  });

  it('reads website, the field author_platform.ts actually writes', () => {
    // The regression itself: this returned null before the fix.
    expect(candidateWebsite({ website: 'https://frankmanforflorida.com/issues' })).toBe(
      'https://frankmanforflorida.com/issues',
    );
  });

  it('falls back to ballotpedia_url when no first-party site exists', () => {
    expect(candidateWebsite({ ballotpedia_url: 'https://ballotpedia.org/x' })).toBe(
      'https://ballotpedia.org/x',
    );
  });

  it('prefers campaign_website over website when a fixture carries both', () => {
    expect(
      candidateWebsite({ campaign_website: 'https://first.example', website: 'https://second.example' }),
    ).toBe('https://first.example');
  });

  it('prefers a first-party site over the ballotpedia fallback', () => {
    expect(
      candidateWebsite({ website: 'https://own.example', ballotpedia_url: 'https://ballotpedia.org/x' }),
    ).toBe('https://own.example');
  });

  it('returns null when the fixture carries no site at all', () => {
    // 150 of the fixture candidates are in exactly this state. NULL is the
    // honest unknown; the column must not invent a value.
    expect(candidateWebsite({ name: 'Nobody' })).toBeNull();
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
  ])('treats a %s campaign_website as absent, not as a link to nowhere', (_label, value) => {
    expect(candidateWebsite({ campaign_website: value })).toBeNull();
  });

  it('skips an empty campaign_website and still finds the real site behind it', () => {
    expect(candidateWebsite({ campaign_website: '', website: 'https://real.example' })).toBe(
      'https://real.example',
    );
  });

  it('trims surrounding whitespace so the stored URL is clean', () => {
    expect(candidateWebsite({ website: '  https://real.example  ' })).toBe('https://real.example');
  });

  it.each([
    ['a number', 12345],
    ['null', null],
    ['undefined', undefined],
    ['an object', { href: 'https://x.example' }],
  ])('ignores %s rather than coercing it into the column', (_label, value) => {
    expect(candidateWebsite({ campaign_website: value })).toBeNull();
  });
});
