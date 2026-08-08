// Regression tests for the stale-attribution fix: VotingRecordList used to
// say "Source: ProPublica Congress API" for every row and link an
// incumbent's mid-cycle-departure empty state to GovTrack. Votes now come
// from Congress.gov (House) / Voteview (Senate) per row, and source_url can
// be null (Spec B2, Decision 6). See src/components/VotingRecordList.tsx.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VotingRecordList } from '@/components/VotingRecordList';
import type { CandidateVote } from '@/types/database';

function makeVote(overrides: Partial<CandidateVote> = {}): CandidateVote {
  return {
    id: 'vote-1',
    candidate_id: 'cand-1',
    bill_id: 'hr-1-119',
    bill_title: 'Test Bill',
    vote_question: 'On Passage',
    roll_call_id: 'house-119-2-1',
    bill_summary: null,
    vote: 'yea',
    issue_slugs: ['economy'],
    vote_date: '2026-01-15',
    source: 'congress_gov',
    source_url: null,
    significance: null,
    ...overrides,
  };
}

describe('VotingRecordList', () => {
  it('never renders a GovTrack link or the old static ProPublica footer', () => {
    render(<VotingRecordList votes={[makeVote()]} />);
    expect(screen.queryByText(/ProPublica/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/GovTrack/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /govtrack/i })).not.toBeInTheDocument();
  });

  it('renders a linked source when source_url is present', () => {
    render(
      <VotingRecordList
        votes={[
          makeVote({ source: 'congress_gov', source_url: 'https://congress.gov/bill/hr1' }),
        ]}
      />
    );
    const link = screen.getByRole('link', { name: /Congress\.gov/i });
    expect(link).toHaveAttribute('href', 'https://congress.gov/bill/hr1');
  });

  it('renders the source label as plain text (no link) when source_url is null', () => {
    render(<VotingRecordList votes={[makeVote({ source: 'voteview', source_url: null })]} />);
    expect(screen.getByText(/Source: Voteview/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /voteview/i })).not.toBeInTheDocument();
  });

  it('incumbent empty state names no external source and has no dead/wrong link', () => {
    render(<VotingRecordList votes={[]} incumbent />);
    expect(screen.getByText(/No recent votes on file/i)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('non-incumbent empty state renders the challenger copy', () => {
    render(<VotingRecordList votes={[]} incumbent={false} />);
    expect(screen.getByText(/No voting record/i)).toBeInTheDocument();
  });
});
