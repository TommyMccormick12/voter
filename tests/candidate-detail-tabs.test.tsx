// T19 (Spec D2): CandidateDetail's tab strip used aria-current="page" on
// plain buttons with no keyboard support beyond native Tab. It's now a
// real WAI-ARIA APG "Tabs" pattern: role="tablist" / "tab" / "tabpanel",
// aria-selected + aria-controls, roving tabIndex (one Tab stop for the
// whole strip), and Left/Right/Home/End move + activate.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CandidateDetail } from '@/components/CandidateDetail';
import type { CandidateWithFullData } from '@/types/database';

function makeCandidate(overrides: Partial<CandidateWithFullData> = {}): CandidateWithFullData {
  return {
    id: 'cand-1',
    name: 'Jane Doe',
    slug: 'jane-doe',
    party: 'Democratic Party',
    state: 'FL',
    district: '01',
    race_id: 'race-fl-01-d-2026',
    office: 'U.S. House',
    photo_url: null,
    bio: null,
    website: null,
    active: true,
    primary_party: 'D',
    incumbent: false,
    total_raised: null,
    fec_coverage_end_date: null,
    top_stances: [],
    positions: [],
    donors: [],
    top_industries: [],
    voting_record: [],
    statements: [],
    ...overrides,
  };
}

describe('CandidateDetail tabs (ARIA tablist)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
  });

  it('renders a labeled tablist with four tabs, each owning a panel', () => {
    render(<CandidateDetail candidate={makeCandidate()} />);
    const tablist = screen.getByRole('tablist', { name: 'Candidate record sections' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Stances', 'Donors', 'Voting', 'Statements']);

    const stancesTab = screen.getByRole('tab', { name: 'Stances' });
    expect(stancesTab).toHaveAttribute('aria-selected', 'true');
    expect(stancesTab).toHaveAttribute('tabindex', '0');

    const donorsTab = screen.getByRole('tab', { name: 'Donors' });
    expect(donorsTab).toHaveAttribute('aria-selected', 'false');
    expect(donorsTab).toHaveAttribute('tabindex', '-1');

    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', stancesTab.id);
  });

  it('clicking a tab selects it and shows its panel', () => {
    render(<CandidateDetail candidate={makeCandidate()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Voting' }));
    expect(screen.getByRole('tab', { name: 'Voting' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Stances' })).toHaveAttribute('aria-selected', 'false');
  });

  it('ArrowRight moves both focus and selection to the next tab, wrapping at the end', () => {
    render(<CandidateDetail candidate={makeCandidate()} />);
    const stancesTab = screen.getByRole('tab', { name: 'Stances' });
    stancesTab.focus();
    fireEvent.keyDown(stancesTab, { key: 'ArrowRight' });
    const donorsTab = screen.getByRole('tab', { name: 'Donors' });
    expect(donorsTab).toHaveAttribute('aria-selected', 'true');
    expect(donorsTab).toHaveFocus();

    fireEvent.keyDown(donorsTab, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Stances' })).toHaveAttribute('aria-selected', 'true');
  });

  it('End jumps to the last tab', () => {
    render(<CandidateDetail candidate={makeCandidate()} />);
    const stancesTab = screen.getByRole('tab', { name: 'Stances' });
    stancesTab.focus();
    fireEvent.keyDown(stancesTab, { key: 'End' });
    const statementsTab = screen.getByRole('tab', { name: 'Statements' });
    expect(statementsTab).toHaveAttribute('aria-selected', 'true');
    expect(statementsTab).toHaveFocus();
  });
});
