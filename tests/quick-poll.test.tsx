// T19 (Spec D2): QuickPoll's star rating used a mislabeled
// role="radiogroup" around plain aria-pressed toggle buttons (not real
// ARIA radios), and every star was its own Tab stop. It now declares
// role="group" (honest — the "tap again to clear" gesture isn't valid
// radio behavior) and implements roving tabIndex + Left/Right/Home/End
// keyboard navigation (frontend-standards: "support arrow keys where
// the control requires them").

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QuickPoll } from '@/components/QuickPoll';

const issues = [
  { slug: 'economy', name: 'Economy' },
  { slug: 'healthcare', name: 'Healthcare' },
];

describe('QuickPoll', () => {
  it('renders each issue as a labeled group of star buttons, one tab stop per group', () => {
    render(<QuickPoll issues={issues} />);
    const group = screen.getByRole('group', { name: 'Importance of Economy' });
    const stars = within(group);
    const buttons = stars.getAllByRole('button');
    expect(buttons).toHaveLength(5);
    // Roving tabIndex: exactly one star per group starts as a tab stop.
    expect(buttons.filter((b) => b.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('ArrowRight moves roving focus to the next star without changing the rating', () => {
    render(<QuickPoll issues={issues} />);
    const group = screen.getByRole('group', { name: 'Importance of Economy' });
    const first = within(group).getByRole('button', { name: '1 star' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const second = within(group).getByRole('button', { name: '2 stars' });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a star sets the rating and clicking it again clears it', () => {
    const onChange = vi.fn();
    render(<QuickPoll issues={issues} onChange={onChange} />);
    const group = screen.getByRole('group', { name: 'Importance of Economy' });
    const third = within(group).getByRole('button', { name: '3 stars' });

    fireEvent.click(third);
    expect(onChange).toHaveBeenLastCalledWith([{ issue_slug: 'economy', weight: 3 }]);

    fireEvent.click(third);
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('Continue is disabled until at least one issue is rated', () => {
    render(<QuickPoll issues={issues} />);
    const continueBtn = screen.getByRole('button', { name: /continue/i });
    expect(continueBtn).toBeDisabled();

    const group = screen.getByRole('group', { name: 'Importance of Economy' });
    fireEvent.click(within(group).getByRole('button', { name: '4 stars' }));
    expect(continueBtn).toBeEnabled();
  });
});
