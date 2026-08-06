// Shared Card primitive (T18, Spec D1). Plain visual container — the
// party-themed hero strip / border stay in the caller via className, since
// party theming is content-driven (getPartyTheme), not a Card concern.

import type { HTMLAttributes, ReactNode } from 'react';

type Padding = 'none' | 'sm' | 'md';
type Shadow = 'none' | 'sm' | 'md';

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  children: ReactNode;
  className?: string;
  padding?: Padding;
  /** Use 'article' for a card that represents one self-contained record
   * (e.g. a candidate scorecard) — keeps native landmark semantics. */
  as?: 'div' | 'article';
  /** Set false when the caller supplies its own border color via
   * className (e.g. party-themed `border-red-300`) — avoids a Tailwind
   * class collision between Card's default border and the caller's. */
  border?: boolean;
  shadow?: Shadow;
}

const PADDING: Record<Padding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-5',
};

const SHADOW: Record<Shadow, string> = {
  none: '',
  sm: 'shadow-sm',
  md: 'shadow-md',
};

export function Card({
  children,
  className = '',
  padding = 'md',
  as = 'div',
  border = true,
  shadow = 'sm',
  ...rest
}: CardProps) {
  const classes = `bg-white rounded-card ${border ? 'border border-gray-200' : ''} ${SHADOW[shadow]} ${PADDING[padding]} ${className}`.trim();

  if (as === 'article') {
    return (
      <article className={classes} {...rest}>
        {children}
      </article>
    );
  }
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
