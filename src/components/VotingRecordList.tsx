'use client';

import { useState } from 'react';
import type { CandidateVote } from '@/types/database';
import { formatLocalDate } from '@/lib/dates';

interface Props {
  votes: CandidateVote[];
  /** Issue slugs to offer as filter chips. Defaults to extracted from votes. */
  filterIssues?: string[];
}

export function VotingRecordList({ votes, filterIssues }: Props) {
  const allIssues =
    filterIssues ?? Array.from(new Set(votes.flatMap((v) => v.issue_slugs))).sort();
  const [activeIssue, setActiveIssue] = useState<string | null>(null);

  if (votes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
        <p className="text-sm text-gray-500 mb-1">No voting record</p>
        <p className="text-xs text-gray-400">
          Non-incumbent candidates have no congressional voting history.
        </p>
      </div>
    );
  }

  const filtered = activeIssue
    ? votes.filter((v) => v.issue_slugs.includes(activeIssue))
    : votes;
  const sorted = [...filtered].sort(
    (a, b) => new Date(b.vote_date).getTime() - new Date(a.vote_date).getTime()
  );

  return (
    <div>
      {allIssues.length > 1 && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          <FilterPill
            label="All"
            active={activeIssue === null}
            onClick={() => setActiveIssue(null)}
          />
          {allIssues.map((slug) => (
            <FilterPill
              key={slug}
              label={issueLabel(slug)}
              active={activeIssue === slug}
              onClick={() => setActiveIssue(slug)}
            />
          ))}
        </div>
      )}

      <div className="space-y-3">
        {sorted.map((v) => (
          <div
            key={v.id}
            className="border border-gray-200 rounded-xl p-4 bg-white"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-gray-500">
                  {formatBillId(v.bill_id)} · {formatDate(v.vote_date)}
                </p>
                <h4 className="text-sm font-semibold text-gray-900 mt-1">
                  {v.bill_title}
                </h4>
                {v.bill_summary && (
                  <p className="text-xs text-gray-600 mt-1 leading-snug">
                    {v.bill_summary}
                  </p>
                )}
              </div>
              <VoteBadge vote={v.vote} />
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {v.issue_slugs.map((slug) => (
                <span
                  key={slug}
                  className="bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full text-[11px] font-medium"
                >
                  {slug}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-4 text-center">
        Source: ProPublica Congress API
      </p>
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      {label}
    </button>
  );
}

function VoteBadge({ vote }: { vote: CandidateVote['vote'] }) {
  const styles: Record<CandidateVote['vote'], string> = {
    yea: 'bg-emerald-100 text-emerald-800',
    nay: 'bg-red-100 text-red-800',
    present: 'bg-yellow-100 text-yellow-800',
    absent: 'bg-gray-100 text-gray-700',
    no_vote: 'bg-gray-100 text-gray-500',
  };
  const labels: Record<CandidateVote['vote'], string> = {
    yea: 'YEA',
    nay: 'NAY',
    present: 'PRESENT',
    absent: 'ABSENT',
    no_vote: '—',
  };
  return (
    <span
      className={`${styles[vote]} px-2.5 py-1 rounded-full text-[11px] font-bold flex-shrink-0`}
    >
      {labels[vote]}
    </span>
  );
}

function issueLabel(slug: string): string {
  return slug
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function formatBillId(billId: string): string {
  // 'hr-1-119' → 'H.R. 1'
  const m = billId.match(/^([a-z]+)-(\d+)/i);
  if (!m) return billId.toUpperCase();
  const chamber = m[1].toUpperCase().replace('HR', 'H.R.').replace('S', 'S.');
  return `${chamber} ${m[2]}`;
}

function formatDate(d: string): string {
  return formatLocalDate(d);
}
