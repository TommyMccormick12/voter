import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRace } from '@/lib/data/races';
import { getCandidatesForRace } from '@/lib/data/candidates';
import { ScorecardCarousel } from '@/components/ScorecardCarousel';
import { getPartyTheme } from '@/lib/party-theme';
import { formatLocalDate } from '@/lib/dates';
import { Badge } from '@/components/ui';
import { coverageCopy } from '@/lib/coverage';

interface PageProps {
  params: Promise<{ raceId: string }>;
}

/**
 * Scorecards page — horizontal-scroll carousel of candidate scorecards
 * for one race. Reads candidates + cached top_stances from Supabase.
 */
export default async function ScorecardsPage({ params }: PageProps) {
  const { raceId } = await params;
  const raceResult = await getRace(raceId);

  if (!raceResult.ok) {
    return <ScorecardsErrorState raceId={raceId} />;
  }

  const race = raceResult.data;
  if (!race) notFound();

  const candidatesResult = await getCandidatesForRace(raceId);
  if (!candidatesResult.ok) {
    return <ScorecardsErrorState raceId={raceId} />;
  }
  const candidates = candidatesResult.data;
  const theme = getPartyTheme(race.primary_party);

  const partyName =
    race.primary_party === 'R'
      ? 'Republican Primary'
      : race.primary_party === 'D'
        ? 'Democratic Primary'
        : 'Primary';

  const dateLabel = formatLocalDate(race.election_date);

  // One source for both the header label and the disclosure, so the two can
  // never disagree about how much of the ballot this page is showing.
  const coverage = coverageCopy(candidates.length, race.ballot_candidate_count);
  const uncoveredCount =
    race.ballot_candidate_count !== null && race.ballot_candidate_count >= candidates.length
      ? race.ballot_candidate_count - candidates.length
      : null;

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
            className="text-gray-500 text-sm font-medium hover:text-gray-900 inline-flex items-center min-h-[44px] px-2 -mx-2 whitespace-nowrap"
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
              {/* Profiled count, never a bare ballot count — see coverage.ts. */}
              <span>
                {dateLabel} · {coverage.label}
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

      {race.no_primary && (
        <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 mb-6">
          <Badge tone="info" className="flex-shrink-0">
            No primary
          </Badge>
          <p className="text-sm text-blue-950">
            {race.no_primary_note ??
              'No primary — the qualified candidate advances unopposed.'}
          </p>
        </div>
      )}

      {/* Coverage disclosure. The carousel shows only candidates that cleared
          the evidence bar, so on a contested race it can show fewer people
          than the ballot lists — FL-19 R profiles 3 of 10. Without this line
          a thin card set reads as the whole field, which misstates the
          ballot. A no_primary race is genuinely one candidate, so the badge
          above already tells that story and this would contradict it. */}
      {!race.no_primary && coverage.hasUncovered && (
        <p className="text-sm text-gray-500 mb-4">
          {uncoveredCount !== null
            ? `Your ballot lists ${uncoveredCount} other qualified ${
                uncoveredCount === 1 ? 'candidate' : 'candidates'
              }. We add a candidate here once we verify enough policy evidence to describe them fairly.`
            : 'Your ballot may list other qualified candidates. We add a candidate here once we verify enough policy evidence to describe them fairly.'}
        </p>
      )}

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

/**
 * Error state: the read itself failed (DB outage or config problem).
 * The candidate-count empty state ("No candidates yet — being curated")
 * already lives in ScorecardCarousel and covers the legitimate-empty
 * case; this covers the distinct failure case. Retry re-navigates to
 * this same URL, which re-runs the server-side data fetch.
 */
function ScorecardsErrorState({ raceId }: { raceId: string }) {
  return (
    <main className="max-w-2xl mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-gray-900 mb-3">
        We couldn&apos;t load this race right now
      </h1>
      <p className="text-gray-500 mb-6">
        Something went wrong on our end. Try again in a moment.
      </p>
      <div className="flex items-center justify-center gap-3">
        <Link
          href={`/scorecards/${raceId}`}
          className="inline-block bg-blue-600 text-white font-medium px-6 py-3 rounded-lg hover:bg-blue-700"
        >
          Try again
        </Link>
        <Link
          href="/race-picker"
          className="inline-block text-gray-600 font-medium px-6 py-3 rounded-lg hover:bg-gray-100"
        >
          All races
        </Link>
      </div>
    </main>
  );
}
