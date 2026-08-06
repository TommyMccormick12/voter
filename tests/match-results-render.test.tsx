// Component test for T17 (Spec C4) — /match/results renders entirely
// from a server-fetched match record (the `match` prop), never from
// sessionStorage. Also asserts the "estimated match" label is visible
// (not tooltip-only) when the match came from the heuristic fallback,
// and absent for a real Haiku-sourced match.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MatchResults } from '@/app/match/results/MatchResults';
import type { StoredMatch } from '@/lib/app/match';
import type { CandidateWithFullData, Race } from '@/types/database';

// StoredMatch is a type-only import, but Vitest's dependency graph still
// needs 'server-only' resolvable in case a future edit to this component
// pulls in a runtime import from src/lib/app/match.ts.
vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const race: Race = {
  id: 'race-fl-01-r-2026',
  state: 'FL',
  district: '01',
  office: 'U.S. House',
  election_date: '2026-08-18',
  cycle: 2026,
  election_type: 'primary',
  primary_party: 'R',
};

const candidates: CandidateWithFullData[] = [
  {
    id: 'cand-1',
    name: 'Test Candidate',
    slug: 'test-candidate',
    party: 'Republican',
    state: 'FL',
    district: '01',
    race_id: 'race-fl-01-r-2026',
    office: 'U.S. House',
    photo_url: null,
    bio: null,
    website: null,
    active: true,
    primary_party: 'R',
    incumbent: false,
    total_raised: 100000,
    top_stances: [],
  },
];

function makeMatch(source: 'haiku' | 'mock'): StoredMatch {
  return {
    id: 'match-uuid-1',
    raceId: race.id,
    freeText: 'I care about the economy.',
    ranked: [{ candidate_id: 'cand-1', score: 82, matched_stances: [], rationale: 'Strong alignment.' }],
    meta: { cache_hit: false, source, input_tokens: source === 'haiku' ? 100 : undefined, output_tokens: source === 'haiku' ? 40 : undefined },
  };
}

describe('<MatchResults> (T17 — server-fetched, no sessionStorage)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'sessionStorage',
      new Proxy(
        {},
        {
          get() {
            throw new Error('MatchResults must not read sessionStorage (T17 — transport is the match id / props)');
          },
        },
      ),
    );
  });

  it('renders the top match directly from the match prop without touching sessionStorage', () => {
    render(<MatchResults race={race} candidates={candidates} match={makeMatch('haiku')} />);
    // The candidate appears twice by design (expanded top-match card +
    // ranked-list row) — both renders come straight from the match prop.
    expect(screen.getAllByText('Test Candidate').length).toBeGreaterThan(0);
    expect(screen.getByText(/Strong alignment\./)).toBeInTheDocument();
  });

  it('shows a visible "Estimated match" label for a heuristic-fallback (mock) result', () => {
    render(<MatchResults race={race} candidates={candidates} match={makeMatch('mock')} />);
    // Visible banner text, not hidden in a title/tooltip attribute.
    expect(screen.getByText('Estimated match')).toBeInTheDocument();
    expect(
      screen.getByText(/computed with a local heuristic, not the AI matcher/i),
    ).toBeInTheDocument();
  });

  it('does not show the estimated-match label for a real Haiku result', () => {
    render(<MatchResults race={race} candidates={candidates} match={makeMatch('haiku')} />);
    expect(screen.queryByText('Estimated match')).not.toBeInTheDocument();
  });
});
