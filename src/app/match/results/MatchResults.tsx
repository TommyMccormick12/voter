'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getPartyTheme, getPartyInitials } from '@/lib/party-theme';
import { MatchScoreBadge } from '@/components/MatchScoreBadge';
import type {
  CandidateWithFullData,
  MatchResult,
  Race,
} from '@/types/database';

interface Props {
  race: Race;
  candidates: CandidateWithFullData[];
}

interface StoredMatch {
  ranked: MatchResult[];
  free_text: string;
  quick_poll: { issue_slug: string; weight: number }[];
  meta: {
    cache_hit: boolean;
    source: string;
    input_tokens?: number;
    output_tokens?: number;
  };
}

/**
 * Reads the ranked match results from sessionStorage (set by /match flow)
 * and renders the top match (large card) + ranked list (sidebar on desktop).
 *
 * If sessionStorage is empty (e.g. user landed here directly), shows an
 * empty state with a CTA back to the match flow.
 */
export function MatchResults({ race, candidates }: Props) {
  const router = useRouter();
  const [state, setState] = useState<{ hydrated: boolean; match: StoredMatch | null }>({
    hydrated: false,
    match: null,
  });
  const [shareLabel, setShareLabel] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => {
    // Sync from a non-React source (sessionStorage). Single setState call
    // covers both hydration flag + match payload. Rule exception is the
    // documented React 19 pattern for browser-API hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from sessionStorage
    setState(() => {
      try {
        const raw = sessionStorage.getItem(`match-results-${race.id}`);
        return { hydrated: true, match: raw ? JSON.parse(raw) : null };
      } catch (err) {
        console.warn('[match-results] failed to read storage', err);
        return { hydrated: true, match: null };
      }
    });
  }, [race.id]);

  const { hydrated, match } = state;

  if (!hydrated) {
    // First paint — show skeleton to avoid empty-flash before sessionStorage reads
    return (
      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-10">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 bg-gray-200 rounded" />
          <div className="h-10 w-72 bg-gray-200 rounded" />
          <div className="h-64 bg-gray-100 rounded-2xl" />
        </div>
      </main>
    );
  }

  if (!match) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          No match results yet
        </h1>
        <p className="text-gray-500 mb-6">
          Take the 2-step poll to find your closest alignment.
        </p>
        <Link
          href={`/match?race=${race.id}`}
          className="inline-block bg-blue-600 text-white font-medium px-6 py-3 rounded-lg hover:bg-blue-700"
        >
          Start the match →
        </Link>
      </main>
    );
  }

  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  const ranked = match.ranked
    .map((r) => ({ result: r, candidate: candidateById.get(r.candidate_id) }))
    .filter((r): r is { result: MatchResult; candidate: CandidateWithFullData } => !!r.candidate);

  if (ranked.length === 0) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          Match results unavailable
        </h1>
        <p className="text-gray-500 mb-6">Try running the match again.</p>
        <Link
          href={`/match?race=${race.id}`}
          className="inline-block bg-blue-600 text-white font-medium px-6 py-3 rounded-lg hover:bg-blue-700"
        >
          Try again →
        </Link>
      </main>
    );
  }

  const top = ranked[0];
  const rest = ranked.slice(1);
  const topTheme = getPartyTheme(top.candidate.primary_party);

  const partyName = (party: string | null): string => {
    if (party === 'R') return 'Republican';
    if (party === 'D') return 'Democrat';
    return 'Independent';
  };

  const raceLabel = `${race.office}${race.district ? ` ${race.state}-${race.district}` : ` ${race.state}`}`;
  const racePartyLabel =
    race.primary_party === 'R'
      ? 'Republican Primary'
      : race.primary_party === 'D'
        ? 'Democratic Primary'
        : 'Primary';

  return (
    <main className="max-w-7xl mx-auto px-4 lg:px-8 py-8 lg:py-10">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6 lg:mb-8">
        <button
          type="button"
          onClick={() => router.push(`/match?race=${race.id}`)}
          className="text-gray-500 text-sm font-medium hover:text-gray-900"
        >
          ← Edit answers
        </button>
        <button
          type="button"
          onClick={async () => {
            const url = new URL('/share', window.location.origin);
            url.searchParams.set('race', race.id);
            url.searchParams.set('c', top.candidate.slug);
            url.searchParams.set('s', String(Math.round(top.result.score)));
            const shareUrl = url.toString();

            // Prefer native share sheet on mobile, fall back to clipboard.
            const nav = navigator as Navigator & { share?: (data: { url: string; title?: string }) => Promise<void> };
            if (typeof nav.share === 'function') {
              try {
                await nav.share({ url: shareUrl, title: `My top match: ${top.candidate.name}` });
                return;
              } catch {
                // user cancelled — fall through to clipboard
              }
            }
            try {
              await navigator.clipboard.writeText(shareUrl);
              setShareLabel('copied');
              setTimeout(() => setShareLabel('idle'), 2000);
            } catch {
              setShareLabel('error');
              setTimeout(() => setShareLabel('idle'), 2000);
            }
          }}
          className="text-sm text-gray-600 px-4 py-2 hover:bg-gray-100 rounded-lg"
        >
          {shareLabel === 'copied'
            ? 'Link copied ✓'
            : shareLabel === 'error'
              ? 'Copy failed'
              : 'Share results'}
        </button>
      </div>

      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        For {raceLabel} {racePartyLabel}
      </p>
      <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-2">
        Your top match
      </h1>
      <p className="text-gray-500 mb-6 lg:mb-8">
        Based on your priorities and what you wrote
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Top match — expanded */}
        <div className="lg:col-span-7">
          <div className={`${topTheme.heroBg} border-2 ${topTheme.border} rounded-2xl p-5 lg:p-8`}>
            <div className="flex items-start gap-4 lg:gap-5 mb-5">
              <div
                className={`w-16 h-16 lg:w-20 lg:h-20 rounded-full ${topTheme.avatarGradient} flex items-center justify-center text-white text-xl lg:text-2xl font-bold flex-shrink-0`}
                aria-hidden="true"
              >
                {getPartyInitials(top.candidate.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-bold ${topTheme.text} uppercase tracking-wide`}>
                  Top match
                </p>
                <h2 className="text-xl lg:text-2xl font-bold text-gray-900 leading-tight">
                  {top.candidate.name}
                </h2>
                <p className="text-sm text-gray-700">
                  {partyName(top.candidate.primary_party)} ·{' '}
                  {top.candidate.incumbent ? 'Incumbent' : 'Challenger'}
                  {top.candidate.district ? ` · ${top.candidate.state}-${top.candidate.district}` : ` · ${top.candidate.state}`}
                </p>
              </div>
              <MatchScoreBadge score={top.result.score} size="lg" colorClass={topTheme.text} />
            </div>

            {top.result.rationale && (
              <p className="text-sm lg:text-base text-gray-800 italic mb-5 leading-relaxed">
                &ldquo;{top.result.rationale}&rdquo;
              </p>
            )}

            {top.result.matched_stances.length > 0 && (
              <>
                <h3 className="text-xs font-bold text-gray-700 uppercase mb-3">
                  Why this match
                </h3>
                <ul className="space-y-2 mb-6">
                  {top.result.matched_stances.map((stanceId) => {
                    const stance = top.candidate.top_stances.find(
                      (s) => s.stance_id === stanceId
                    );
                    if (!stance) return null;
                    return (
                      <li
                        key={stanceId}
                        className="text-sm flex items-start gap-2"
                      >
                        <span className="text-emerald-600 font-bold flex-shrink-0">✓</span>
                        <span className="text-gray-800">
                          {stance.summary}
                          {stance.track_record_note && !stance.track_record_note.startsWith('⚠') && (
                            <span className="text-xs text-gray-500 ml-1">
                              ({stance.track_record_note.replace(/^✓\s*/, '')})
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            <Link
              href={`/candidate/${top.candidate.slug}`}
              className={`inline-block font-medium px-6 py-3 rounded-lg ${topTheme.accent}`}
            >
              See full record →
            </Link>
          </div>
        </div>

        {/* Ranked list */}
        <div className="lg:col-span-5">
          <h3 className="text-xs font-bold text-gray-700 uppercase mb-3">
            All candidates ranked
          </h3>
          <div className="space-y-2">
            <RankedRow
              candidate={top.candidate}
              result={top.result}
              isTop
            />
            {rest.map(({ candidate, result }) => (
              <RankedRow
                key={candidate.id}
                candidate={candidate}
                result={result}
              />
            ))}
          </div>

          <p className="text-xs text-gray-400 mt-6 leading-relaxed">
            Match scores based on Ballotpedia, ProPublica, and OpenSecrets data.
            {match.meta.source === 'mock' && (
              <>
                <br />
                <span className="text-amber-600">
                  ⚠ Demo mode (no API key) — using local heuristic ranking.
                </span>
              </>
            )}
            <br />
            <Link href="#" className="text-blue-600 font-medium">
              How matching works →
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

function RankedRow({
  candidate,
  result,
  isTop = false,
}: {
  candidate: CandidateWithFullData;
  result: MatchResult;
  isTop?: boolean;
}) {
  const theme = getPartyTheme(candidate.primary_party);
  const partyName =
    candidate.primary_party === 'R'
      ? 'Republican'
      : candidate.primary_party === 'D'
        ? 'Democrat'
        : 'Independent';

  return (
    <Link
      href={`/candidate/${candidate.slug}`}
      className={`bg-white border rounded-xl p-3.5 flex items-center gap-3 hover:shadow-md transition ${
        isTop ? `border-2 ${theme.border}` : theme.border
      }`}
    >
      <div
        className={`w-12 h-12 rounded-full ${theme.avatarGradient} flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}
        aria-hidden="true"
      >
        {getPartyInitials(candidate.name)}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className={`text-sm ${isTop ? 'font-bold' : 'font-semibold'} text-gray-900 truncate`}>
          {candidate.name}
        </h4>
        <p className="text-xs text-gray-500 truncate">
          {partyName} · {candidate.incumbent ? 'Incumbent' : 'Challenger'}
        </p>
      </div>
      <MatchScoreBadge
        score={result.score}
        size={isTop ? 'md' : 'sm'}
        colorClass={isTop ? theme.text : 'text-gray-700'}
      />
      {isTop && (
        <p className="absolute"></p>
      )}
    </Link>
  );
}
