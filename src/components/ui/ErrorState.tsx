// Shared ErrorState primitive (T18, Spec D1 / frontend-standards "define
// every data state"). Used for the honest DataResult<T> `ok: false` path
// (never a fake-success render) — provide a retry action when retry is
// safe (frontend-standards forms/data-state rule).

import type { ReactNode } from 'react';
import { Button } from './Button';

interface Props {
  title?: string;
  description?: string;
  onRetry?: () => void;
  /** Retry by navigating (re-runs the server-side data fetch on this URL). */
  retryHref?: string;
  secondaryAction?: ReactNode;
}

export function ErrorState({
  title = "We couldn't load this right now",
  description = 'Something went wrong on our end. Try again in a moment.',
  onRetry,
  retryHref,
  secondaryAction,
}: Props) {
  return (
    <div role="alert" className="max-w-2xl mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-gray-900 mb-3">{title}</h1>
      <p className="text-gray-500 mb-6">{description}</p>
      <div className="flex items-center justify-center gap-3">
        {retryHref ? (
          <Button href={retryHref} variant="primary">
            Try again
          </Button>
        ) : onRetry ? (
          <Button onClick={onRetry} variant="primary">
            Try again
          </Button>
        ) : null}
        {secondaryAction}
      </div>
    </div>
  );
}
