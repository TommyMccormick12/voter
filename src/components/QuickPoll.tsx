'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { Button } from './ui/Button';

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

      <Button
        type="button"
        onClick={() => onSubmit?.(responses)}
        disabled={!canContinue}
        fullWidth
        size="lg"
      >
        Continue →
      </Button>

      <p className="text-xs text-gray-400 text-center mt-3">
        {responses.length === 0
          ? 'Tap at least one issue'
          : `${responses.length} of ${issues.length} rated`}
      </p>
    </div>
  );
}

const STAR_VALUES = [1, 2, 3, 4, 5];

/**
 * Star rating row — a group of 5 toggle buttons (role="group", not
 * "radiogroup": tapping the current value again clears it back to 0,
 * which real ARIA radios cannot do, so "group" is the honest role).
 * Roving tabIndex gives the group one Tab stop; Left/Right/Home/End move
 * focus across the 5 stars (frontend-standards: "support arrow keys
 * where the control requires them").
 */
function StarRow({
  weight,
  onSet,
  issueName,
}: {
  weight: number;
  onSet: (w: number) => void;
  issueName: string;
}) {
  const [focusedIndex, setFocusedIndex] = useState(weight > 0 ? weight - 1 : 0);
  const starRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = Math.min(index + 1, STAR_VALUES.length - 1);
    else if (event.key === 'ArrowLeft') nextIndex = Math.max(index - 1, 0);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = STAR_VALUES.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setFocusedIndex(nextIndex);
    starRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="flex gap-1" role="group" aria-label={`Importance of ${issueName}`}>
      {STAR_VALUES.map((n, index) => (
        <button
          key={n}
          ref={(el) => {
            starRefs.current[index] = el;
          }}
          type="button"
          onClick={() => onSet(n)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          onFocus={() => setFocusedIndex(index)}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          aria-pressed={weight >= n}
          tabIndex={focusedIndex === index ? 0 : -1}
          className={`text-2xl leading-none transition min-w-[44px] min-h-[44px] flex items-center justify-center -mx-0.5 ${
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
