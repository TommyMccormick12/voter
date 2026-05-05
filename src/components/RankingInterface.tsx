'use client';

import { useState } from 'react';
import { saveRankings, getPercentile } from '@/lib/rankings';
import type { Issue, AggregatedPriority, PercentileResult } from '@/types/database';

interface RankingIssue {
  id: string;
  name: string;
  slug: string;
  category: string | null;
}

interface Props {
  issues: RankingIssue[];
  zip: string;
  communityData: AggregatedPriority[];
}

export function RankingInterface({ issues, zip, communityData }: Props) {
  const [ranked, setRanked] = useState<RankingIssue[]>([]);
  const [unranked, setUnranked] = useState<RankingIssue[]>(issues);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<PercentileResult[] | null>(null);
  const [error, setError] = useState('');

  function addToRanking(issue: RankingIssue) {
    setRanked([...ranked, issue]);
    setUnranked(unranked.filter((i) => i.id !== issue.id));
  }

  function removeFromRanking(issue: RankingIssue) {
    setUnranked([...unranked, issue]);
    setRanked(ranked.filter((i) => i.id !== issue.id));
  }

  async function handleSave() {
    if (ranked.length < 3) return;

    setSaving(true);
    setError('');

    const { success, error: saveError } = await saveRankings(
      ranked.map((i) => i.id)
    );

    if (!success) {
      setError(saveError || 'Something went wrong');
      setSaving(false);
      return;
    }

    const percentiles = await getPercentile(
      ranked.map((i) => ({ id: i.id, slug: i.slug })),
      zip
    );
    setResults(percentiles);
    setSaving(false);
  }

  function getShareUrl() {
    const slugs = ranked.map((i) => i.slug).join(',');
    const topPercentile = results?.[0]?.percentile ?? 50;
    return `/share?r=${slugs}&zip=${zip}&p=${topPercentile}`;
  }

  if (results) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-gray-900">
          Your priorities vs. your community
        </h2>
        <div className="space-y-3">
          {results.map((r, i) => {
            const issue = ranked[i];
            return (
              <div
                key={r.issue_id}
                className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg"
              >
                <span className="text-blue-600 font-bold w-6">{i + 1}</span>
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{issue?.name}</p>
                  <p className="text-sm text-gray-500">
                    {r.percentile > 60
                      ? `Top ${100 - r.percentile}% — your community agrees`
                      : r.percentile < 40
                        ? `Only ${r.percentile}% rank this as high as you`
                        : 'About average for your area'}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`text-sm font-medium ${
                      r.percentile > 60
                        ? 'text-green-600'
                        : r.percentile < 40
                          ? 'text-orange-600'
                          : 'text-gray-500'
                    }`}
                  >
                    {r.percentile}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-center pt-4 space-y-3">
          <a
            href={getShareUrl()}
            className="inline-block px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Share your priorities
          </a>
          <p className="text-xs text-gray-400">
            See how friends compare when they rank their own
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {ranked.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Your priorities (most important first)
          </h2>
          <div className="space-y-2">
            {ranked.map((issue, index) => (
              <div
                key={issue.id}
                className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg"
              >
                <span className="text-blue-600 font-bold text-sm w-6">
                  {index + 1}
                </span>
                <span className="flex-1 text-gray-900 font-medium">
                  {issue.name}
                </span>
                <button
                  onClick={() => removeFromRanking(issue)}
                  className="text-gray-400 hover:text-red-500 text-sm"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {unranked.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            {ranked.length > 0 ? 'Remaining issues' : 'Tap to rank'}
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {unranked.map((issue) => (
              <button
                key={issue.id}
                onClick={() => addToRanking(issue)}
                className="p-3 border border-gray-200 rounded-lg text-left hover:border-blue-300 hover:bg-blue-50 transition-colors"
              >
                <span className="text-gray-900 font-medium text-sm">
                  {issue.name}
                </span>
                {issue.category && (
                  <span className="block text-gray-400 text-xs mt-1">
                    {issue.category}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {ranked.length >= 3 && (
        <div className="mt-8 text-center">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-8 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'See how you compare'}
          </button>
          {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
          <p className="text-xs text-gray-400 mt-2">
            Rank at least 3 issues to see your community comparison
          </p>
        </div>
      )}

      {communityData.length > 0 && ranked.length === 0 && (
        <div className="mt-8 pt-8 border-t border-gray-100">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Your community&apos;s top priorities
          </h2>
          <div className="space-y-2">
            {communityData.slice(0, 5).map((agg, i) => (
              <div
                key={agg.issue_id}
                className="flex items-center gap-3 p-2 text-sm"
              >
                <span className="text-gray-400 w-5">{i + 1}.</span>
                <span className="text-gray-700">{agg.issue_name}</span>
                <span className="ml-auto text-gray-400 text-xs">
                  {agg.count} votes
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
