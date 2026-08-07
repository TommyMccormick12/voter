'use client';

import { useState } from 'react';
import type { CandidateVote, DataSource } from '@/types/database';
import { formatLocalDate } from '@/lib/dates';
import { Badge } from './ui/Badge';
import { EmptyState } from './ui/EmptyState';

interface Props {
  votes: CandidateVote[];
  /** Issue slugs to offer as filter chips. Defaults to extracted from votes. */
  filterIssues?: string[];
  /**
   * Whether this candidate currently holds the seat. Used to pick the
   * right empty-state copy when votes is empty: incumbent-with-no-votes
   * means "left office mid-cycle" (e.g. Rubio → SecState), while
   * non-incumbent-with-no-votes means "challenger, no congressional
   * history". Defaults to false (challenger).
   */
  incumbent?: boolean;
}

export function VotingRecordList({ votes, filterIssues, incumbent = false }: Props) {
  const allIssues =
    filterIssues ?? Array.from(new Set(votes.flatMap((v) => v.issue_slugs))).sort();
  const [activeIssue, setActiveIssue] = useState<string | null>(null);

  if (votes.length === 0) {
    // Incumbent-with-zero-votes happens when a sitting member leaves the
    // seat mid-cycle (resignation, appointment, death). The FEC ballot
    // still lists them but the current-Congress feed (Congress.gov for the
    // House, Voteview for the Senate) returns no rows. The default
    // "challenger has no history" copy would be misleading.
    if (incumbent) {
      return (
        <EmptyState
          tone="warning"
          title="No recent votes on file"
          description="This candidate appears on the FEC ballot but does not have a current-cycle congressional voting record — typically because they left office mid-cycle."
        />
      );
    }
    return (
      <EmptyState
        title="No voting record"
        description="Non-incumbent candidates have no congressional voting history."
      />
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
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {v.issue_slugs.map((slug) => (
                <span
                  key={slug}
                  className="bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full text-[11px] font-medium"
                >
                  {slug}
                </span>
              ))}
              <VoteSource source={v.source} sourceUrl={v.source_url} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Per-row source attribution. Votes now come from Congress.gov (House) or
 * Voteview (Senate) — never GovTrack (Spec B2, Decision 6). `source_url`
 * may be null; render the label without a link rather than a dead/wrong
 * one.
 */
function VoteSource({
  source,
  sourceUrl,
}: {
  source: DataSource | null;
  sourceUrl: string | null;
}) {
  if (!source) return null;
  const label = voteSourceLabel(source);
  if (sourceUrl) {
    return (
      <a
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-auto text-[11px] text-blue-600 font-medium hover:text-blue-700 underline-offset-2 hover:underline"
      >
        Source: {label} →
      </a>
    );
  }
  return <span className="ml-auto text-[11px] text-gray-400">Source: {label}</span>;
}

function voteSourceLabel(source: DataSource): string {
  if (source === 'congress_gov') return 'Congress.gov';
  if (source === 'voteview') return 'Voteview';
  if (source === 'govtrack') return 'GovTrack'; // legacy rows pre-B2 migration
  return 'Official record';
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
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition min-h-[32px] ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      {label}
    </button>
  );
}

const VOTE_TONE: Record<CandidateVote['vote'], 'success' | 'error' | 'warning' | 'neutral'> = {
  yea: 'success',
  nay: 'error',
  present: 'warning',
  absent: 'neutral',
  no_vote: 'neutral',
};

const VOTE_LABEL: Record<CandidateVote['vote'], string> = {
  yea: 'YEA',
  nay: 'NAY',
  present: 'PRESENT',
  absent: 'ABSENT',
  no_vote: '—',
};

function VoteBadge({ vote }: { vote: CandidateVote['vote'] }) {
  return (
    <Badge tone={VOTE_TONE[vote]} className="flex-shrink-0">
      {VOTE_LABEL[vote]}
    </Badge>
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
