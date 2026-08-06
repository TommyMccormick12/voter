'use client';

// Shared Button primitive (T18, Spec D1 — frontend-standards "use shared
// controls for buttons"). Renders a native <button> by default, or a
// Next.js <Link> when `href` is given, so the same visual system covers
// both actions and navigation without losing native semantics (frontend-
// standards: "preserve native HTML meaning inside shared components").

import Link from 'next/link';
import type { MouseEventHandler, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Shows a spinner and disables the control. Use for in-flight submits. */
  loading?: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  onClick?: MouseEventHandler;
  id?: string;
  'aria-label'?: string;
  'aria-pressed'?: boolean;
  'aria-describedby'?: string;
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
}

interface ButtonAsButton extends CommonProps {
  href?: undefined;
  type?: 'button' | 'submit' | 'reset';
}

interface ButtonAsLink extends CommonProps {
  href: string;
  target?: string;
  rel?: string;
}

export type ButtonProps = ButtonAsButton | ButtonAsLink;

const BASE =
  'inline-flex items-center justify-center gap-2 font-medium rounded-control transition disabled:opacity-50 disabled:cursor-not-allowed';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700',
  secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50',
  ghost: 'text-gray-600 hover:bg-gray-100',
  danger: 'bg-status-error text-white hover:bg-red-700',
};

// `className` is appended last for state/layout additions only (colors not
// covered by `variant`, flex-item sizing like `flex-1`). Never use it to
// override text size, padding, or font-weight — Tailwind's cascade is
// decided by generated stylesheet order, not by position in this string,
// so a caller-supplied `text-base` does not reliably beat SIZE_CLASSES's
// `text-sm`. Add a new `size`/`variant` instead.
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'text-sm px-3 min-h-[36px]',
  md: 'text-sm px-5 min-h-[44px]',
  lg: 'text-base lg:text-lg px-5 py-3.5 min-h-[52px]',
};

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Button(props: ButtonProps) {
  const {
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    loading = false,
    disabled = false,
    children,
    className = '',
    onClick,
    id,
  } = props;

  const classes = cx(
    BASE,
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    fullWidth && 'w-full',
    className
  );

  if ('href' in props && props.href) {
    return (
      <Link
        href={props.href}
        target={props.target}
        rel={props.rel}
        onClick={onClick}
        className={classes}
        id={id}
        aria-label={props['aria-label']}
        aria-describedby={props['aria-describedby']}
      >
        {loading && <ButtonSpinner />}
        {children}
      </Link>
    );
  }

  const buttonType = (props as ButtonAsButton).type ?? 'button';
  return (
    <button
      type={buttonType}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={onClick}
      id={id}
      aria-label={props['aria-label']}
      aria-pressed={props['aria-pressed']}
      aria-describedby={props['aria-describedby']}
      aria-expanded={props['aria-expanded']}
      aria-controls={props['aria-controls']}
    >
      {loading && <ButtonSpinner />}
      {children}
    </button>
  );
}

function ButtonSpinner() {
  return (
    <span
      className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
      aria-hidden="true"
    />
  );
}
