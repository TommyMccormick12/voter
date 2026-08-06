// Smoke + accessibility tests for the shared primitive catalog (T18, Spec
// D1). frontend-standards requires: accessible name on every control,
// error associated to its field, status conveyed by more than color alone.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TextInput } from '@/components/ui/TextInput';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';

describe('Button', () => {
  it('renders a native <button type="button"> by default and fires onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toHaveAttribute('type', 'button');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders as a link when href is given, preserving native <a> semantics', () => {
    render(<Button href="/race-picker">Find your primary</Button>);
    const link = screen.getByRole('link', { name: 'Find your primary' });
    expect(link).toHaveAttribute('href', '/race-picker');
  });

  it('disables the control and marks aria-busy while loading', () => {
    render(<Button loading>Submitting</Button>);
    const btn = screen.getByRole('button', { name: 'Submitting' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('forwards aria-pressed for toggle-style usage', () => {
    render(<Button aria-pressed={true}>★ Saved</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Badge', () => {
  it('renders status tone children as visible text — never color-only', () => {
    render(<Badge tone="error">NAY</Badge>);
    expect(screen.getByText('NAY')).toBeInTheDocument();
  });

  it('renders a party tone', () => {
    render(
      <Badge tone="party" partyKey="D">
        Democrat
      </Badge>
    );
    expect(screen.getByText('Democrat')).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('shows the title and description', () => {
    render(<EmptyState title="No candidates yet" description="Curating." />);
    expect(screen.getByText('No candidates yet')).toBeInTheDocument();
    expect(screen.getByText('Curating.')).toBeInTheDocument();
  });

  it('renders an action when provided', () => {
    render(<EmptyState title="No results" action={<button>Reset filters</button>} />);
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('shows a retry button that calls onRetry', () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders retry as a navigable link when retryHref is given', () => {
    render(<ErrorState retryHref="/candidate/jane-doe" />);
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/candidate/jane-doe'
    );
  });

  it('has role=alert so assistive tech announces the failure', () => {
    render(<ErrorState />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('form primitives', () => {
  it('TextInput associates its error with the field via aria-describedby', () => {
    render(<TextInput id="email" label="Email" error="Invalid email" />);
    const input = screen.getByLabelText('Email');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent('Invalid email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('Textarea shows a live character count', () => {
    render(<Textarea id="details" label="Details" value="hello" maxLength={20} showCount readOnly />);
    expect(screen.getByText('5 / 20')).toBeInTheDocument();
  });

  it('Select renders every option with a visible label', () => {
    render(
      <Select
        id="category"
        label="Category"
        options={[
          { value: 'a', label: 'Option A' },
          { value: 'b', label: 'Option B' },
        ]}
      />
    );
    const select = screen.getByLabelText('Category');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Option A' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Option B' })).toBeInTheDocument();
  });
});
