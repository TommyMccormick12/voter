// T19 (Spec D2): FreeTextMatcher used to render a raw <textarea> with an
// sr-only label and its own hand-rolled hint/counter/error markup,
// duplicating what the shared Textarea primitive (src/components/ui/
// Textarea.tsx) already does. It now uses that primitive directly (a
// visible label, per frontend-standards "give each field a visible
// label"), and moves focus to the field after a failed submit
// (frontend-standards forms rule).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FreeTextMatcher } from '@/components/FreeTextMatcher';

describe('FreeTextMatcher', () => {
  it('renders a visible label (not sr-only) via the shared Textarea primitive', () => {
    render(<FreeTextMatcher />);
    const textarea = screen.getByLabelText('Tell us in your own words');
    expect(textarea).toBeInTheDocument();
    const label = screen.getByText('Tell us in your own words');
    expect(label.className).not.toMatch(/sr-only/);
  });

  it('shows a field error and moves focus to the textarea on a too-short submit', () => {
    const onSubmit = vi.fn();
    render(<FreeTextMatcher onSubmit={onSubmit} />);
    const textarea = screen.getByLabelText('Tell us in your own words');
    fireEvent.change(textarea, { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /find my match/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/at least 10 characters/i);
    expect(textarea).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with the trimmed text once the minimum length is met', () => {
    const onSubmit = vi.fn();
    render(<FreeTextMatcher onSubmit={onSubmit} />);
    const textarea = screen.getByLabelText('Tell us in your own words');
    fireEvent.change(textarea, { target: { value: '  I care about the economy.  ' } });
    fireEvent.click(screen.getByRole('button', { name: /find my match/i }));
    expect(onSubmit).toHaveBeenCalledWith('I care about the economy.');
  });

  it('disables the submit control and shows a busy state while loading', () => {
    render(<FreeTextMatcher loading />);
    const btn = screen.getByRole('button', { name: /matching/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });
});
