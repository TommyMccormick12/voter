// Tests for scripts/ingest/fetch_platform.ts's Wikidata-gated platform
// fetch (Ticket T09). Verifies the rewired flow: resolveCandidacyQid()
// runs first, and getWikipediaCandidate() is called ONLY when the gate
// passes — the old "guess a title, take the first hit" path is gone.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveCandidacyQid } from '@/lib/api-clients/wikidata';
import { getWikipediaCandidate } from '@/lib/api-clients/wikipedia';
import { extractPlatform } from '@/lib/llm/extract-platform';
import {
  fetchPlatformForCandidate,
  type PlatformCandidate,
} from '../scripts/ingest/fetch_platform';

vi.mock('@/lib/api-clients/wikidata', () => ({
  resolveCandidacyQid: vi.fn(),
}));
vi.mock('@/lib/api-clients/wikipedia', () => ({
  getWikipediaCandidate: vi.fn(),
}));
vi.mock('@/lib/llm/extract-platform', () => ({
  extractPlatform: vi.fn(),
}));

const mockResolve = vi.mocked(resolveCandidacyQid);
const mockGetWikipedia = vi.mocked(getWikipediaCandidate);
const mockExtract = vi.mocked(extractPlatform);

function candidate(overrides: Partial<PlatformCandidate> = {}): PlatformCandidate {
  return {
    name: 'Daniel Webster',
    office: 'U.S. House',
    state: 'FL',
    district: '11',
    ...overrides,
  };
}

beforeEach(() => {
  mockResolve.mockReset();
  mockGetWikipedia.mockReset();
  mockExtract.mockReset();
});

describe('fetchPlatformForCandidate', () => {
  it('Daniel Webster case: a gated candidate never triggers a Wikipedia fetch', async () => {
    mockResolve.mockResolvedValue({
      gated: true,
      reason:
        'no candidate QID for "Daniel Webster" survived verification: Q170581 has a death date (1852) before the 2026 cycle',
    });

    const c = candidate();
    await fetchPlatformForCandidate(c, 2026);

    expect(mockResolve).toHaveBeenCalledWith({
      name: 'Daniel Webster',
      office: 'U.S. House',
      state: 'FL',
      district: '11',
      cycle: 2026,
    });
    expect(mockGetWikipedia).not.toHaveBeenCalled();
    expect(mockExtract).not.toHaveBeenCalled();
    // The fixture's wrong-person bio must not get written.
    expect(c.bio).toBeUndefined();
  });

  it('pass case: a verified QID drives a single Wikipedia fetch by the gate-provided title', async () => {
    mockResolve.mockResolvedValue({
      gated: false,
      qid: 'Q7176958',
      matchedVia: 'P3602',
      enwikiTitle: 'Maxwell Frost',
    });
    mockGetWikipedia.mockResolvedValue({
      url: 'https://en.wikipedia.org/wiki/Maxwell_Frost',
      found: true,
      lead_paragraph: 'Maxwell Alejandro Frost is an American politician.',
      website: 'https://frost.house.gov',
      political_positions_text: 'Frost supports expanding health coverage.',
      political_subsections: ['Healthcare'],
    });
    mockExtract.mockResolvedValue({
      positions: [
        {
          issue_slug: 'healthcare',
          summary: 'Supports expanding health coverage.',
          source_excerpt: 'Frost supports expanding health coverage.',
        },
      ],
      source: 'haiku',
      input_tokens: 100,
      output_tokens: 50,
    });

    const c = candidate({ name: 'Maxwell Frost', district: '10' });
    await fetchPlatformForCandidate(c, 2026);

    expect(mockGetWikipedia).toHaveBeenCalledTimes(1);
    expect(mockGetWikipedia).toHaveBeenCalledWith('Maxwell Frost');
    expect(c.bio).toBe('Maxwell Alejandro Frost is an American politician.');
    expect(c.campaign_website).toBe('https://frost.house.gov');
    expect(c.key_messages).toEqual(['Supports expanding health coverage.']);
    expect(c.campaign_themes).toEqual([
      { heading: 'healthcare', text: 'Supports expanding health coverage.' },
    ]);
    expect(c.platform_excerpts).toEqual([
      {
        issue_slug: 'healthcare',
        excerpt: 'Frost supports expanding health coverage.',
        source: 'wikipedia',
        source_url: 'https://en.wikipedia.org/wiki/Maxwell_Frost',
      },
    ]);
  });

  it('no-QID case: an explicit miss skips Wikipedia and leaves the fixture untouched', async () => {
    mockResolve.mockResolvedValue({
      gated: true,
      reason: 'no Wikidata entity found for "Someone Nobody Has Heard Of"',
    });

    const c = candidate({ name: 'Someone Nobody Has Heard Of' });
    await fetchPlatformForCandidate(c, 2026);

    expect(mockGetWikipedia).not.toHaveBeenCalled();
    expect(c.bio).toBeUndefined();
    expect(c.key_messages).toBeUndefined();
  });

  it('a verified QID with no English Wikipedia sitelink still fetches nothing from Wikipedia', async () => {
    mockResolve.mockResolvedValue({
      gated: false,
      qid: 'Q999',
      matchedVia: 'P768',
      enwikiTitle: null,
    });

    const c = candidate();
    await fetchPlatformForCandidate(c, 2026);

    expect(mockGetWikipedia).not.toHaveBeenCalled();
    expect(c.bio).toBeUndefined();
  });
});
