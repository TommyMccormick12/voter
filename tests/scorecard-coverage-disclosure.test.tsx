// The scorecard carousel shows only candidates that cleared the evidence
// bar, so on a contested race it can show fewer people than the ballot
// lists (FL-19 R profiles 3 of 10). Two honesty rules follow, and this
// file pins both:
//
//   1. A contested race MUST disclose that the ballot can hold candidates
//      we have not profiled. Without it, a thin card set reads as the whole
//      field and misstates the ballot.
//   2. A no_primary race MUST NOT show that line. There, one candidate is
//      the whole truth, and the disclosure would contradict the badge.
//
// The counts rendered here are profiled counts, never ballot counts, so a
// bare "N candidates" must not reappear on either surface.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const getRaceMock = vi.fn();
const getCandidatesForRaceMock = vi.fn();

vi.mock('@/lib/data/races', () => ({
  getRace: (...args: unknown[]) => getRaceMock(...args),
}));
vi.mock('@/lib/data/candidates', () => ({
  getCandidatesForRace: (...args: unknown[]) => getCandidatesForRaceMock(...args),
}));
vi.mock('@/components/ScorecardCarousel', () => ({
  ScorecardCarousel: () => <div data-testid="carousel" />,
}));

const DISCLOSURE = /your ballot may list other qualified candidates/i;

function race(overrides: Record<string, unknown> = {}) {
  return {
    id: 'race-fl-19-r-2026',
    state: 'FL',
    district: '19',
    office: 'U.S. House',
    primary_party: 'R',
    election_date: '2026-08-18',
    no_primary: false,
    no_primary_note: null,
    ...overrides,
  };
}

function candidate(id: string) {
  return { id, name: `Candidate ${id}`, slug: id, primary_party: 'R', top_stances: [] };
}

async function renderPage(raceRow: Record<string, unknown>, candidates: unknown[]) {
  getRaceMock.mockResolvedValue({ ok: true, data: raceRow });
  getCandidatesForRaceMock.mockResolvedValue({ ok: true, data: candidates });
  const { default: ScorecardsPage } = await import('@/app/scorecards/[raceId]/page');
  const ui = await ScorecardsPage({ params: Promise.resolve({ raceId: raceRow.id as string }) });
  render(ui);
}

describe('scorecard coverage disclosure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('discloses possible uncovered candidates on a contested race', async () => {
    await renderPage(race(), [candidate('a'), candidate('b'), candidate('c')]);
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument();
  });

  it('still discloses when only one candidate cleared the bar', async () => {
    // The worst case: 1 of 8 profiled. Silence here is what makes a
    // contested primary read as a coronation.
    await renderPage(race({ id: 'race-fl-14-r-2026', district: '14' }), [candidate('a')]);
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument();
  });

  it('does NOT disclose on a no_primary race, where one candidate is the truth', async () => {
    await renderPage(
      race({
        id: 'race-fl-12-r-2026',
        district: '12',
        no_primary: true,
        no_primary_note: 'No primary — Gus Michael Bilirakis qualified unopposed and advances',
      }),
      [candidate('a')],
    );
    expect(screen.queryByText(DISCLOSURE)).not.toBeInTheDocument();
    expect(screen.getByText(/qualified unopposed and advances/i)).toBeInTheDocument();
  });

  it('never states a bare candidate count that would imply a ballot size', async () => {
    await renderPage(race(), [candidate('a'), candidate('b'), candidate('c')]);
    // "3 with policy data" is honest; "3 candidates" claims the field.
    expect(screen.getByText(/3 with policy data/i)).toBeInTheDocument();
    expect(screen.queryByText(/·\s*3 candidates\b/i)).not.toBeInTheDocument();
  });
});
