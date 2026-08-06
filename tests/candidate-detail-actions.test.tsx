// T20 (Spec D3): Save/Share on /candidate/[slug] were previously inert
// placeholder <button>s with no onClick. Save now reuses the scorecard's
// candidate_interactions saved/unsaved toggle; Share hands off to the
// existing /share flow. Neither renders when raceId is unknown — no dead
// controls (Spec: "Wire ... or remove").

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CandidateDetailActions } from '@/components/CandidateDetailActions';

describe('CandidateDetailActions', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    );
  });

  it('renders Save and Share with accessible names when raceId is known', () => {
    render(
      <CandidateDetailActions
        candidateId="cand-1"
        candidateSlug="jane-doe"
        raceId="race-fl-01-r-2026"
      />
    );
    expect(screen.getByRole('button', { name: /save candidate/i })).toBeInTheDocument();
    const shareLink = screen.getByRole('link', { name: /share this candidate/i });
    expect(shareLink).toHaveAttribute('href', '/share?race=race-fl-01-r-2026&c=jane-doe');
  });

  it('renders no controls at all when raceId is null — no dead controls', () => {
    render(<CandidateDetailActions candidateId="cand-1" candidateSlug="jane-doe" raceId={null} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('toggles aria-pressed and posts a saved interaction on click', async () => {
    render(
      <CandidateDetailActions
        candidateId="cand-1"
        candidateSlug="jane-doe"
        raceId="race-fl-01-r-2026"
      />
    );
    const saveBtn = screen.getByRole('button', { name: /save candidate/i });
    expect(saveBtn).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(saveBtn);

    expect(screen.getByRole('button', { name: /unsave candidate/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/interaction',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"action":"saved"'),
      })
    );
  });
});
