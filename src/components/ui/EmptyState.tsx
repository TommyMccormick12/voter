// Shared EmptyState primitive (T18, Spec D1 / frontend-standards "define
// every data state"). Covers both "empty data" (nothing exists yet) and
// "empty filtered results" (filters produced zero rows) — pass `action`
// for the reset/create control frontend-standards requires for each.

import type { ReactNode } from 'react';

interface Props {
  title: string;
  description?: string;
  action?: ReactNode;
  /** 'warning' — an expected-but-notable absence (e.g. an incumbent with
   * no current-cycle votes). Default 'neutral' — an ordinary empty state. */
  tone?: 'neutral' | 'warning';
}

export function EmptyState({ title, description, action, tone = 'neutral' }: Props) {
  const border = tone === 'warning' ? 'border-amber-300 bg-amber-50' : 'border-gray-300 bg-gray-50';
  const titleColor = tone === 'warning' ? 'text-amber-900' : 'text-gray-500';
  const descColor = tone === 'warning' ? 'text-amber-800' : 'text-gray-400';

  return (
    <div className={`rounded-card border border-dashed ${border} p-6 text-center`}>
      <p className={`text-sm font-medium mb-1 ${titleColor}`}>{title}</p>
      {description && <p className={`text-xs max-w-md mx-auto ${descColor}`}>{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
