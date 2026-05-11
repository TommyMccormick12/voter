import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRace } from '@/lib/data/races';
import { getCandidatesForRace } from '@/lib/data/candidates';
import { ScorecardCarousel } from '@/components/ScorecardCarousel';
import { getPartyTheme } from '@/lib/party-theme';
import { formatLocalDate } from '@/lib/dates';

interface PageProps {
  params: Promise<{ raceId: string }>;
}

/**
 * Scorecards page — horizontal-scroll carousel of candidate scorecards
 * for one race. Reads candidates + cached top_stances from Supabase.
 */
export default async function ScorecardsPage({ params }: PageProps) {
  const { raceId } = await params;
  const race = await getRace(raceId);

  if (!race) notFound();

  const candidates = await getCandidatesForRace(raceId);
  const theme = getPartyTheme(race.primary_party);

  const partyName =
    race.primary_party === 'R'
      ? 'Republican Primary'
      : race.primary_party === 'D'
        ? 'Democratic Primary'
        : 'Primary';

  const dateLabel = formatLocalDate(race.election_date);

  const officeLabel = `${race.office}${
    race.district ? ` — ${race.state}-${race.district}` : ` — ${race.state}`
  }`;

  return (
    <main className="max-w-7xl mx-auto px-4 lg:px-8 py-6 lg:py-10">
      {/* Race header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6 lg:mb-8">
        <div className="flex items-center gap-3 lg:gap-4">
          <Link
            href="/race-picker"
            className="text-gray-500 text-sm font-medium hover:text-gray-900 inline-flex items-center min-h-[44px] px-2 -mx-2"
          >
            ← All races
          </Link>
          <span className="text-gray-300 hidden lg:inline">·</span>
          <div>
            <h1 className="text-lg lg:text-xl font-bold text-gray-900">
              {officeLabel}
            </h1>
            <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
              <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full ${theme.accent}`}>
                {partyName}
              </span>
              <span>
                {dateLabel} · {candidates.length} candidate
                {candidates.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        </div>
        {candidates.length >= 3 ? (
          <Link
            href={`/match?race=${race.id}`}
            className={`inline-flex items-center justify-center min-h-[44px] text-sm font-semibold px-5 rounded-lg text-center ${theme.accent}`}
          >
            Find my best match →
          </Link>
        ) : null}
      </div>

      <p className="text-sm text-gray-500 mb-4 hidden lg:block">
        Browse scorecards. Click any card for the full record.
      </p>

      <ScorecardCarousel
        candidates={candidates}
        raceId={race.id}
        layout="auto"
      />

      {/* Match flow only delivers value at 3+ candidates — below that, ranking
          is trivial and the result is "you match X" with no real signal.
          Show soft copy instead. */}
      {candidates.length >= 3 ? (
        <div className="mt-10 text-center">
          <p className="text-sm text-gray-500 mb-3">
            Want to know which one fits you best?
          </p>
          <Link
            href={`/match?race=${race.id}`}
            className={`inline-block font-semibold px-8 py-3 rounded-lg shadow-md hover:shadow-lg transition ${theme.accent}`}
          >
            Find my best match →
          </Link>
        </div>
      ) : candidates.length > 0 ? (
        <p className="mt-10 text-center text-sm text-gray-500">
          {candidates.length === 1
            ? '1 candidate with policy data in this race. Explore the full record above; match comparison opens when we have 3+ candidates.'
            : `${candidates.length} candidates with policy data in this race. Explore their records above; match comparison opens when we have 3+ candidates.`}
        </p>
      ) : null}
    </main>
  );
}
