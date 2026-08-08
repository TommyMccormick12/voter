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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
const SOFT_MATCH_COPY = /match comparison opens/i;

function matchLinks(raceId: string) {
  return screen
    .queryAllByRole('link', { name: /find my best match/i })
    .filter((el) => el.getAttribute('href') === `/match?race=${raceId}`);
}

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

  it('names the exact number of uncovered candidates when the ballot size is known', async () => {
    // FL-19 R: 3 profiled, 10 on the ballot. Vague copy here wastes a fact
    // we actually have.
    await renderPage(race({ ballot_candidate_count: 10 }), [
      candidate('a'),
      candidate('b'),
      candidate('c'),
    ]);
    expect(screen.getByText(/lists 7 other qualified candidates/i)).toBeInTheDocument();
    expect(screen.getByText(/3 of 10 candidates/i)).toBeInTheDocument();
  });

  it('uses the singular when exactly one candidate is uncovered', async () => {
    await renderPage(race({ ballot_candidate_count: 4 }), [
      candidate('a'),
      candidate('b'),
      candidate('c'),
    ]);
    expect(screen.getByText(/lists 1 other qualified candidate\./i)).toBeInTheDocument();
  });

  it('drops the disclosure entirely once the whole ballot is covered', async () => {
    await renderPage(race({ ballot_candidate_count: 3 }), [
      candidate('a'),
      candidate('b'),
      candidate('c'),
    ]);
    expect(screen.queryByText(DISCLOSURE)).not.toBeInTheDocument();
    expect(screen.queryByText(/other qualified candidate/i)).not.toBeInTheDocument();
    expect(screen.getByText(/all 3 candidates/i)).toBeInTheDocument();
  });

  it('keeps the vaguer disclosure when the ballot size is unknown', async () => {
    await renderPage(race({ ballot_candidate_count: null }), [candidate('a')]);
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument();
  });

  // The match CTA gate. Presentational only — the match API rejects a race
  // with zero candidates and nothing else — but the CTA is what a voter can
  // actually find, so it decides whether the feature exists for them.
  it('offers match on a fully covered two-candidate race, in both places', async () => {
    // FL-Sen D. Two on the ballot, both profiled, and dark before this rule.
    await renderPage(race({ id: 'race-fl-sen-d-2026', district: null, ballot_candidate_count: 2 }), [
      candidate('a'),
      candidate('b'),
    ]);
    expect(matchLinks('race-fl-sen-d-2026')).toHaveLength(2);
    expect(screen.queryByText(SOFT_MATCH_COPY)).not.toBeInTheDocument();
  });

  it('leaves a 3+ race exactly as it was', async () => {
    await renderPage(race({ ballot_candidate_count: 10 }), [
      candidate('a'),
      candidate('b'),
      candidate('c'),
    ]);
    expect(matchLinks('race-fl-19-r-2026')).toHaveLength(2);
    expect(screen.queryByText(SOFT_MATCH_COPY)).not.toBeInTheDocument();
  });

  it('withholds match from a partially covered two-candidate race', async () => {
    // 2 profiled of 5. The three we cannot describe are exactly why ranking
    // the two would mislead, so the soft copy stays.
    await renderPage(race({ ballot_candidate_count: 5 }), [candidate('a'), candidate('b')]);
    expect(matchLinks('race-fl-19-r-2026')).toHaveLength(0);
    expect(screen.getByText(SOFT_MATCH_COPY)).toBeInTheDocument();
  });

  it('withholds match when the ballot size is unknown, never assuming full coverage', async () => {
    await renderPage(race({ ballot_candidate_count: null }), [candidate('a'), candidate('b')]);
    expect(matchLinks('race-fl-19-r-2026')).toHaveLength(0);
    expect(screen.getByText(SOFT_MATCH_COPY)).toBeInTheDocument();
  });

  it('withholds match from a no_primary race, where there is nothing to rank', async () => {
    await renderPage(
      race({
        id: 'race-fl-12-r-2026',
        district: '12',
        no_primary: true,
        no_primary_note: 'No primary — Gus Michael Bilirakis qualified unopposed and advances',
        ballot_candidate_count: 1,
      }),
      [candidate('a')],
    );
    expect(matchLinks('race-fl-12-r-2026')).toHaveLength(0);
  });

  it('never promises match "when we have 3+", which a covered two-way disproves', async () => {
    await renderPage(race({ ballot_candidate_count: 5 }), [candidate('a'), candidate('b')]);
    expect(screen.queryByText(/opens when we have 3\+/i)).not.toBeInTheDocument();
  });

  // Once the vote has happened, ranking candidates is not a smaller version
  // of the same feature — it is a false invitation. The cards stay as a
  // record; the CTA does not.
  describe('after the primary has been held', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 7, 25));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('withdraws the match CTA from a race that would otherwise offer it', async () => {
      await renderPage(race({ ballot_candidate_count: 3 }), [
        candidate('a'),
        candidate('b'),
        candidate('c'),
      ]);
      expect(matchLinks('race-fl-19-r-2026')).toHaveLength(0);
    });

    it('says the primary was held, and says it without claiming a result', async () => {
      await renderPage(race({ ballot_candidate_count: 3 }), [
        candidate('a'),
        candidate('b'),
        candidate('c'),
      ]);
      expect(screen.getByText(/this primary was held on/i)).toBeInTheDocument();
      expect(screen.getByText(/do not report results/i)).toBeInTheDocument();
      expect(screen.queryByText(/(won|winner|advances|elected)/i)).not.toBeInTheDocument();
    });

    it('keeps the scorecards themselves, which are the record', async () => {
      await renderPage(race({ ballot_candidate_count: 3 }), [candidate('a'), candidate('b')]);
      expect(screen.getByTestId('carousel')).toBeInTheDocument();
    });

    it('drops the "opens once we cover more" copy, which can no longer come true', async () => {
      await renderPage(race({ ballot_candidate_count: 8 }), [candidate('a')]);
      expect(screen.queryByText(SOFT_MATCH_COPY)).not.toBeInTheDocument();
    });
  });

  it('still offers match on election day itself, when people are voting', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 18, 19));
    await renderPage(race({ ballot_candidate_count: 3 }), [
      candidate('a'),
      candidate('b'),
      candidate('c'),
    ]);
    expect(matchLinks('race-fl-19-r-2026')).toHaveLength(2);
    expect(screen.queryByText(/this primary was held on/i)).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('never states a bare candidate count that would imply a ballot size', async () => {
    await renderPage(race(), [candidate('a'), candidate('b'), candidate('c')]);
    // "3 with policy data" is honest; "3 candidates" claims the field.
    expect(screen.getByText(/3 with policy data/i)).toBeInTheDocument();
    expect(screen.queryByText(/·\s*3 candidates\b/i)).not.toBeInTheDocument();
  });
});
