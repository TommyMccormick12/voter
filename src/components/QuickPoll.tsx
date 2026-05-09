'use client';

import { useState } from 'react';

export interface PollIssue {
  slug: string;
  name: string;
}

export interface PollResponse {
  issue_slug: string;
  weight: number; // 1-5
}

interface Props {
  issues: PollIssue[];
  initialWeights?: Record<string, number>;
  onChange?: (responses: PollResponse[]) => void;
  onSubmit?: (responses: PollResponse[]) => void;
}

/**
 * Quick poll — tap stars (1-5) for each issue's importance.
 * Default weight is 0 (skipped). Highlighted card when selected.
 */
export function QuickPoll({ issues, initialWeights = {}, onChange, onSubmit }: Props) {
  const [weights, setWeights] = useState<Record<string, number>>(initialWeights);

  const setWeight = (slug: string, weight: number) => {
    const next = { ...weights };
    if (next[slug] === weight) {
      // Tapping same star again clears it
      delete next[slug];
    } else {
      next[slug] = weight;
    }
    setWeights(next);
    onChange?.(toResponses(next));
  };

  const responses = toResponses(weights);
  const canContinue = responses.length > 0;

  return (
    <div>
      <div className="space-y-3 mb-8">
        {issues.map((issue) => {
          const weight = weights[issue.slug] ?? 0;
          const active = weight > 0;
          return (
            <div
              key={issue.slug}
              className={`border rounded-xl p-4 flex items-center justify-between transition ${
                active
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <span className="text-base font-medium text-gray-900">{issue.name}</span>
              <StarRow
                weight={weight}
                onSet={(w) => setWeight(issue.slug, w)}
                issueName={issue.name}
              />
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => onSubmit?.(responses)}
        disabled={!canContinue}
        className="w-full bg-blue-600 text-white text-base lg:text-lg font-medium py-3.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        Continue →
      </button>

      <p className="text-xs text-gray-400 text-center mt-3">
        {responses.length === 0
          ? 'Tap at least one issue'
          : `${responses.length} of ${issues.length} rated`}
      </p>
    </div>
  );
}

function StarRow({
  weight,
  onSet,
  issueName,
}: {
  weight: number;
  onSet: (w: number) => void;
  issueName: string;
}) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={`Importance of ${issueName}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onSet(n)}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          aria-pressed={weight >= n}
          className={`text-2xl leading-none transition ${
            weight >= n ? 'text-amber-400' : 'text-gray-300 hover:text-amber-200'
          }`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function toResponses(weights: Record<string, number>): PollResponse[] {
  return Object.entries(weights).map(([issue_slug, weight]) => ({
    issue_slug,
    weight,
  }));
}
