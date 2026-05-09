'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { QuickPoll, type PollResponse } from '@/components/QuickPoll';
import { FreeTextMatcher } from '@/components/FreeTextMatcher';
import type { Issue } from '@/types/database';

interface Props {
  raceId: string;
  issues: Pick<Issue, 'slug' | 'name'>[];
}

/**
 * Client wizard: Step 1 quick poll → Step 2 free text → POST /api/match
 * → push to /match/results with ranked results in URL state.
 *
 * The ranked results aren't kept in URL (too big); we use sessionStorage
 * to pass them to the next page. This avoids a re-fetch on /results.
 */
export function MatchFlow({ raceId, issues }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [pollResponses, setPollResponses] = useState<PollResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handlePollSubmit = (responses: PollResponse[]) => {
    setPollResponses(responses);
    // Persist quick poll separately (B2B data product source).
    void fetch('/api/quick-poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ race_id: raceId, responses }),
      keepalive: true,
    }).catch(() => {
      /* swallow — analytics failure must not block UX */
    });
    setStep(2);
  };

  const handleMatchSubmit = async (free_text: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          race_id: raceId,
          free_text,
          quick_poll: pollResponses,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json();

      // Hand the ranked results to the results page via sessionStorage.
      // Avoids passing a giant payload through the URL.
      sessionStorage.setItem(
        `match-results-${raceId}`,
        JSON.stringify({
          ranked: data.ranked,
          free_text,
          quick_poll: pollResponses,
          meta: data.meta,
        })
      );

      router.push(`/match/results?race=${raceId}`);
    } catch (err) {
      console.error('[match] failed', err);
      setError(
        err instanceof Error
          ? `Couldn't compute your match: ${err.message}`
          : "Couldn't compute your match. Try again."
      );
      setLoading(false);
    }
  };

  return (
    <main className="max-w-3xl mx-auto px-4 lg:px-8 py-8 lg:py-12">
      <div className="flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={() => (step === 2 ? setStep(1) : router.back())}
          className="text-gray-500 text-sm font-medium hover:text-gray-900"
        >
          ← Back
        </button>
        <span className="text-sm text-gray-500">
          Step <span className="font-bold text-gray-900">{step}</span> of 2
        </span>
      </div>

      {step === 1 ? (
        <>
          <h1 className="text-2xl lg:text-4xl font-bold text-gray-900 leading-tight mb-2 lg:mb-3">
            What matters most to you?
          </h1>
          <p className="text-base lg:text-lg text-gray-500 mb-6 lg:mb-8">
            Tap stars for each issue. Skip any that don&apos;t apply.
          </p>
          <QuickPoll issues={issues} onSubmit={handlePollSubmit} />
        </>
      ) : (
        <>
          <h1 className="text-2xl lg:text-4xl font-bold text-gray-900 leading-tight mb-2 lg:mb-3">
            Tell us in your own words.
          </h1>
          <p className="text-base lg:text-lg text-gray-500 mb-6 lg:mb-8">
            What do you actually care about? We&apos;ll match it to candidate
            positions, voting records, and donor profiles.
          </p>
          <FreeTextMatcher onSubmit={handleMatchSubmit} loading={loading} />
          {error && (
            <p role="alert" className="text-red-500 text-sm mt-3">
              {error}
            </p>
          )}
        </>
      )}
    </main>
  );
}
