// T19 (Spec D2 / B3): DonorProfile used to say "Source: OpenSecrets · FEC
// filings" for every candidate — stale, since money now comes from FEC
// totals directly (OpenSecrets retired its public API, see AGENTS.md).
// It now says "Source: FEC filings" and renders `coverageEndDate` (FEC's
// `coverage_end_date`, Spec B3) next to the dollar figure whenever the
// pipeline has populated it — never a guessed or fabricated date.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DonorProfile } from '@/components/DonorProfile';

describe('DonorProfile', () => {
  it('attributes money to FEC filings only — no stale OpenSecrets mention', () => {
    render(
      <DonorProfile
        topIndustries={[]}
        donors={[]}
        totalRaised={1_000_000}
        primaryParty="D"
      />
    );
    expect(screen.getByText('Source: FEC filings')).toBeInTheDocument();
    expect(screen.queryByText(/OpenSecrets/i)).not.toBeInTheDocument();
  });

  it('renders the coverage end date next to the total when present', () => {
    render(
      <DonorProfile
        topIndustries={[]}
        donors={[]}
        totalRaised={1_000_000}
        coverageEndDate="2026-06-30"
        primaryParty="D"
      />
    );
    expect(screen.getByText(/through Jun 30, 2026/)).toBeInTheDocument();
  });

  it('renders no coverage line when the date is absent — never a guessed date', () => {
    render(
      <DonorProfile
        topIndustries={[]}
        donors={[]}
        totalRaised={1_000_000}
        primaryParty="D"
      />
    );
    expect(screen.queryByText(/through/)).not.toBeInTheDocument();
  });
});
