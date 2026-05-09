'use client';

import { useState } from 'react';
import type {
  CandidateWithFullData,
  CandidatePosition,
  TopStance,
} from '@/types/database';
import { getPartyTheme, getPartyInitials } from '@/lib/party-theme';
import { DonorProfile } from './DonorProfile';
import { VotingRecordList } from './VotingRecordList';
import { StatementTimeline } from './StatementTimeline';
import { InconsistencyBadge, classifyTrackRecord } from './InconsistencyBadge';
import { trackInteraction } from '@/lib/interactions-client';

interface Props {
  candidate: CandidateWithFullData;
}

type Tab = 'stances' | 'donors' | 'voting' | 'statements';

export function CandidateDetail({ candidate }: Props) {
  const theme = getPartyTheme(candidate.primary_party);
  const initials = getPartyInitials(candidate.name);
  const [tab, setTab] = useState<Tab>('stances');

  const raisedLabel = candidate.total_raised
    ? `$${(candidate.total_raised / 1_000_000).toFixed(2)}M`
    : null;

  const partyName =
    candidate.primary_party === 'R'
      ? 'Republican'
      : candidate.primary_party === 'D'
        ? 'Democrat'
        : 'Independent';

  const officeLabel = [partyName, candidate.incumbent ? 'Incumbent' : 'Challenger']
    .filter(Boolean)
    .join(' · ');

  const handleTabChange = (next: Tab) => {
    setTab(next);
    if (next === 'donors')
      void trackInteraction({
        candidate_id: candidate.id,
        race_id: candidate.race_id ?? '',
        action: 'viewed_donors',
      });
    if (next === 'voting')
      void trackInteraction({
        candidate_id: candidate.id,
        race_id: candidate.race_id ?? '',
        action: 'viewed_votes',
      });
    if (next === 'statements')
      void trackInteraction({
        candidate_id: candidate.id,
        race_id: candidate.race_id ?? '',
        action: 'viewed_statements',
      });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 lg:py-8">
      {/* Hero */}
      <div className={`${theme.heroBg} rounded-2xl p-6 lg:p-8 mb-6 lg:mb-8 flex items-center gap-4 lg:gap-6`}>
        <div
          className={`w-20 h-20 lg:w-28 lg:h-28 rounded-full ${theme.avatarGradient} flex items-center justify-center text-white text-2xl lg:text-4xl font-bold flex-shrink-0 shadow-lg`}
          aria-hidden="true"
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${theme.accent}`}>
              {partyName}
            </span>
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-white/80 text-gray-700">
              {candidate.incumbent ? 'Incumbent' : 'Challenger'}
            </span>
          </div>
          <h1 className="text-2xl lg:text-4xl font-bold text-gray-900 leading-tight">
            {candidate.name}
          </h1>
          <p className="text-sm lg:text-base text-gray-700 mt-1">
            {candidate.office}
            {candidate.district && ` · ${candidate.state}-${candidate.district}`}
            {!candidate.district && ` · ${candidate.state}`}
            {' · '}
            {officeLabel}
          </p>
        </div>
        {raisedLabel && (
          <div className="text-right hidden sm:block">
            <p className={`text-xs font-bold ${theme.text} uppercase`}>2026 Cycle</p>
            <p className="text-2xl lg:text-3xl font-bold text-gray-900">{raisedLabel}</p>
            <p className="text-xs text-gray-600">raised</p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6 overflow-x-auto sticky top-14 bg-white z-10">
        <TabButton
          label="Stances"
          active={tab === 'stances'}
          onClick={() => handleTabChange('stances')}
          tabBorder={theme.tabBorder}
        />
        <TabButton
          label="Donors"
          active={tab === 'donors'}
          onClick={() => handleTabChange('donors')}
          tabBorder={theme.tabBorder}
        />
        <TabButton
          label="Voting"
          active={tab === 'voting'}
          onClick={() => handleTabChange('voting')}
          tabBorder={theme.tabBorder}
        />
        <TabButton
          label="Statements"
          active={tab === 'statements'}
          onClick={() => handleTabChange('statements')}
          tabBorder={theme.tabBorder}
        />
      </div>

      {/* Tab content */}
      {tab === 'stances' && (
        <StancesTab
          stances={candidate.top_stances ?? []}
          positions={candidate.positions ?? []}
          accent={theme.accent}
        />
      )}
      {tab === 'donors' && (
        <DonorProfile
          topIndustries={candidate.top_industries ?? []}
          donors={candidate.donors ?? []}
          totalRaised={candidate.total_raised}
          primaryParty={candidate.primary_party}
        />
      )}
      {tab === 'voting' && (
        <VotingRecordList votes={candidate.voting_record ?? []} />
      )}
      {tab === 'statements' && (
        <StatementTimeline statements={candidate.statements ?? []} />
      )}
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
  tabBorder,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tabBorder: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition border-b-2 ${
        active ? tabBorder : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      {label}
    </button>
  );
}

function StancesTab({
  stances,
  positions,
  accent,
}: {
  stances: TopStance[];
  positions: CandidatePosition[];
  accent: string;
}) {
  if (stances.length === 0 && positions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
        <p className="text-sm text-gray-500">No stances curated yet for this candidate.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-12 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Stances on top issues</h2>
        {stances.map((stance) => (
          <StanceCard key={stance.stance_id} stance={stance} accent={accent} />
        ))}
      </div>
    </div>
  );
}

function StanceCard({
  stance,
  accent,
}: {
  stance: TopStance;
  accent: string;
}) {
  const stanceLabel = formatStance(stance.stance);
  const variant = stance.track_record_note
    ? classifyTrackRecord(stance.track_record_note)
    : null;
  const cleanNote = stance.track_record_note?.replace(/^[✓⚠]\s*/, '');

  return (
    <div className="border border-gray-200 rounded-xl p-5 bg-white">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <span className="text-xs font-bold text-gray-500 uppercase">
          {issueLabel(stance.issue_slug)}
        </span>
        <StanceBadge stance={stance.stance} accent={accent} label={stanceLabel} />
      </div>
      <p className="text-gray-900 mb-3 leading-relaxed">{stance.summary}</p>
      {stance.source_excerpt && (
        <blockquote className="text-sm text-gray-700 italic border-l-2 border-gray-200 pl-3 mb-3">
          &ldquo;{stance.source_excerpt}&rdquo;
        </blockquote>
      )}
      {variant && cleanNote && (
        <InconsistencyBadge variant={variant} message={cleanNote} />
      )}
      {stance.source_url && (
        <a
          href={stance.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 font-medium hover:text-blue-700"
        >
          Source: {sourceLabelFromUrl(stance.source_url)} →
        </a>
      )}
    </div>
  );
}

function StanceBadge({
  stance,
  accent,
  label,
}: {
  stance: TopStance['stance'];
  accent: string;
  label: string;
}) {
  if (stance === 'strongly_support' || stance === 'support') {
    return (
      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${accent}`}>
        {label}
      </span>
    );
  }
  if (stance === 'strongly_oppose' || stance === 'oppose') {
    return (
      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-orange-100 text-orange-700">
        {label}
      </span>
    );
  }
  return (
    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-700">
      {label}
    </span>
  );
}

function formatStance(s: TopStance['stance']): string {
  const map: Record<TopStance['stance'], string> = {
    strongly_support: 'Strongly support',
    support: 'Support',
    neutral: 'Neutral',
    oppose: 'Oppose',
    strongly_oppose: 'Strongly oppose',
  };
  return map[s];
}

function issueLabel(slug: string): string {
  const map: Record<string, string> = {
    economy: 'Economy & Jobs',
    healthcare: 'Healthcare',
    immigration: 'Immigration',
    climate: 'Climate & Energy',
    education: 'Education',
    guns: 'Gun Policy',
    criminal_justice: 'Criminal Justice',
    foreign_policy: 'Foreign Policy',
    taxes: 'Taxes',
    housing: 'Housing',
  };
  return map[slug] ?? slug;
}

function sourceLabelFromUrl(url: string): string {
  if (!url) return 'Source';
  const u = url.toLowerCase();
  if (u.includes('ballotpedia')) return 'Ballotpedia';
  if (u.includes('opensecrets')) return 'OpenSecrets';
  if (u.includes('propublica')) return 'ProPublica';
  if (u.includes('congress.gov')) return 'Congress.gov';
  if (u.includes('fec.gov')) return 'FEC';
  return 'Campaign site';
}
