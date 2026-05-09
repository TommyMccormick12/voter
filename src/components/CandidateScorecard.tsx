'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { CandidateWithFullData, TopStance } from '@/types/database';
import { getPartyTheme, getPartyInitials } from '@/lib/party-theme';
import { trackInteraction } from '@/lib/interactions-client';

interface Props {
  candidate: CandidateWithFullData;
  raceId: string;
  viewOrder: number;
  /** When true, this card is the active/visible card in a carousel — start dwell timer */
  isActive?: boolean;
  onSaved?: (saved: boolean) => void;
  initialSaved?: boolean;
}

export function CandidateScorecard({
  candidate,
  raceId,
  viewOrder,
  isActive = true,
  onSaved,
  initialSaved = false,
}: Props) {
  const theme = getPartyTheme(candidate.primary_party);
  const initials = getPartyInitials(candidate.name);
  const [saved, setSaved] = useState(initialSaved);

  // Dwell time tracking — starts when card becomes active, fires on inactive/unmount
  const dwellStartRef = useRef<number | null>(null);
  const hasReportedRef = useRef(false);

  useEffect(() => {
    if (isActive) {
      dwellStartRef.current = performance.now();
      hasReportedRef.current = false;
    } else if (dwellStartRef.current !== null && !hasReportedRef.current) {
      const dwell = Math.round(performance.now() - dwellStartRef.current);
      hasReportedRef.current = true;
      void trackInteraction({
        candidate_id: candidate.id,
        race_id: raceId,
        action: 'viewed',
        view_order: viewOrder,
        dwell_ms: dwell,
      });
    }
    return () => {
      if (dwellStartRef.current !== null && !hasReportedRef.current) {
        const dwell = Math.round(performance.now() - dwellStartRef.current);
        hasReportedRef.current = true;
        void trackInteraction({
          candidate_id: candidate.id,
          race_id: raceId,
          action: 'viewed',
          view_order: viewOrder,
          dwell_ms: dwell,
        });
      }
    };
  }, [isActive, candidate.id, raceId, viewOrder]);

  const handleSave = () => {
    const next = !saved;
    setSaved(next);
    onSaved?.(next);
    void trackInteraction({
      candidate_id: candidate.id,
      race_id: raceId,
      action: next ? 'saved' : 'unsaved',
      view_order: viewOrder,
    });
  };

  const incumbencyLabel = candidate.incumbent ? 'Incumbent' : 'Challenger';

  const stances = (candidate.top_stances ?? []).slice(0, 3);
  const topIndustries = (candidate.top_industries ?? []).slice(0, 3);
  const raisedLabel = candidate.total_raised
    ? `$${(candidate.total_raised / 1_000_000).toFixed(2)}M raised`
    : null;

  return (
    <article
      className={`bg-white rounded-2xl shadow-md border ${theme.border} overflow-hidden h-full flex flex-col`}
      data-candidate-id={candidate.id}
    >
      {/* Hero strip — party-themed */}
      <div className={`${theme.heroBg} p-5 flex items-center gap-4`}>
        <div
          className={`w-20 h-20 rounded-full ${theme.avatarGradient} flex items-center justify-center text-white text-2xl font-bold shadow-md flex-shrink-0`}
          aria-hidden="true"
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${theme.accent}`}>
              {candidate.primary_party ?? 'I'}
            </span>
            <span className="text-[10px] font-medium px-2.5 py-1 rounded-full bg-white/80 text-gray-700">
              {incumbencyLabel}
            </span>
          </div>
          <h2 className="text-lg font-bold text-gray-900 leading-tight">
            {candidate.name}
          </h2>
          {raisedLabel && (
            <p className="text-xs text-gray-600 mt-0.5">{raisedLabel}</p>
          )}
        </div>
      </div>

      {/* Stances — scrollable area */}
      <div className="p-4 flex-1 overflow-y-auto">
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">
          Top Stances
        </p>
        <div className="space-y-2.5">
          {stances.map((stance) => (
            <StanceRow key={stance.stance_id} stance={stance} theme={theme} />
          ))}
          {stances.length === 0 && (
            <p className="text-xs text-gray-400 italic">No stance data yet.</p>
          )}
        </div>

        {topIndustries.length > 0 && (
          <div className={`mt-4 ${theme.softBg} rounded-lg p-2.5`}>
            <p className="text-[10px] font-bold text-gray-500 uppercase mb-0.5">
              Top funded by
            </p>
            <p className="text-xs text-gray-800">
              {topIndustries.map((i) => i.industry_name).join(' · ')}
            </p>
          </div>
        )}
      </div>

      {/* CTAs — Save + Full record */}
      <div className="p-3 border-t border-gray-100 flex gap-2">
        <button
          onClick={handleSave}
          className={`flex-1 text-sm font-medium py-2.5 rounded-lg transition ${
            saved
              ? `${theme.softBg} ${theme.text}`
              : 'text-gray-600 hover:bg-gray-50'
          }`}
          aria-pressed={saved}
        >
          {saved ? '★ Saved' : '★ Save'}
        </button>
        <Link
          href={`/candidate/${candidate.slug}`}
          className={`flex-1 text-sm font-medium py-2.5 rounded-lg text-center ${theme.accent}`}
          onClick={() =>
            void trackInteraction({
              candidate_id: candidate.id,
              race_id: raceId,
              action: 'viewed_detail',
              view_order: viewOrder,
            })
          }
        >
          Full record →
        </Link>
      </div>
    </article>
  );
}

function StanceRow({
  stance,
  theme,
}: {
  stance: TopStance;
  theme: ReturnType<typeof getPartyTheme>;
}) {
  return (
    <div className={`border-l-2 ${theme.stanceBorder} pl-2.5`}>
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-xs font-bold text-gray-500 uppercase">
          {issueLabel(stance.issue_slug)}
        </span>
        <SourcePill url={stance.source_url} />
      </div>
      <p className="text-sm text-gray-900 leading-snug">{stance.summary}</p>
      {stance.track_record_note && (
        <TrackRecordBadge note={stance.track_record_note} />
      )}
    </div>
  );
}

function SourcePill({ url }: { url: string }) {
  const label = sourceLabelFromUrl(url);
  return (
    <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-[11px] font-medium">
      {label}
    </span>
  );
}

function TrackRecordBadge({ note }: { note: string }) {
  // Heuristic: notes starting with ✓ are alignment, ⚠ are inconsistency
  const isWarn = note.startsWith('⚠') || /contradict|donor|funded by/i.test(note);
  const cls = isWarn
    ? 'bg-amber-100 text-amber-900'
    : 'bg-emerald-50 text-emerald-800';
  const prefix = isWarn ? '⚠' : '✓';
  const cleanNote = note.replace(/^[✓⚠]\s*/, '');
  return (
    <span
      className={`${cls} px-2.5 py-1 rounded-full text-[11px] font-medium mt-1.5 inline-block`}
    >
      {prefix} {cleanNote}
    </span>
  );
}

// ================== helpers ==================
function issueLabel(slug: string): string {
  const map: Record<string, string> = {
    economy: 'Economy',
    healthcare: 'Healthcare',
    immigration: 'Immigration',
    climate: 'Climate',
    education: 'Education',
    guns: 'Guns',
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
  if (u.includes('govtrack')) return 'GovTrack';
  return 'Campaign site';
}
