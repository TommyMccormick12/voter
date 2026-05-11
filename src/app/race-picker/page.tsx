import Link from 'next/link';
import { getRacesForZip } from '@/lib/data/races';
import { getCandidateSamplesForRaces } from '@/lib/data/candidates';
import { getPartyTheme } from '@/lib/party-theme';
import { formatLocalDate, daysUntilLocalDate } from '@/lib/dates';
import type { Race } from '@/types/database';

interface PageProps {
  searchParams: Promise<{ zip?: string }>;
}

interface CandidateSample {
  count: number;
  sample: Array<{ id: string; name: string }>;
}

/**
 * Race picker page — shows federal midterm primaries near the user's zip.
 * Data reads come from Supabase via src/lib/data/{races,candidates}.
 */
export default async function RacePickerPage({ searchParams }: PageProps) {
  const { zip } = await searchParams;

  if (!zip) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-3">No zip code provided</h1>
        <p className="text-gray-500 mb-6">
          Enter your zip code on the homepage to find your primary races.
        </p>
        <Link
          href="/"
          className="inline-block bg-blue-600 text-white font-medium px-6 py-3 rounded-lg hover:bg-blue-700"
        >
          Go to homepage →
        </Link>
      </main>
    );
  }

  const races = await getRacesForZip(zip);
  // Single batch query for all race candidate samples — keeps RaceCard
  // free of per-card fetches (the mock implementation hid an N+1 here).
  const samples = await getCandidateSamplesForRaces(races.map((r) => r.id));
  // Server component runs per request; "days until" is computed once here
  // and threaded down to RaceCard so the inner component stays pure.
  // eslint-disable-next-line react-hooks/purity -- server component, intentional per-request value
  const nowMs = Date.now();

  return (
    <main className="max-w-3xl mx-auto px-4 py-10 lg:py-12">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Zip {zip}
      </p>
      <h1 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-2">
        {races.length === 0
          ? 'No federal primaries found'
          : races.length === 1
            ? '1 federal primary near you'
            : `${races.length} federal primaries near you`}
      </h1>
      <p className="text-base lg:text-lg text-gray-500 mb-8">
        House, Senate, and Governor · Florida primary August 18, 2026
      </p>

      {races.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {races.map((race) => (
            <RaceCard
              key={race.id}
              race={race}
              nowMs={nowMs}
              candidates={samples[race.id] ?? { count: 0, sample: [] }}
            />
          ))}
        </div>
      )}

      <p className="text-sm text-gray-400 text-center mt-12">
        Don&apos;t see your race?{' '}
        <Link href="/" className="text-blue-600 font-medium">
          More coming soon
        </Link>
      </p>
    </main>
  );
}

function RaceCard({
  race,
  nowMs,
  candidates,
}: {
  race: Race;
  nowMs: number;
  candidates: CandidateSample;
}) {
  const theme = getPartyTheme(race.primary_party);
  const partyName =
    race.primary_party === 'R'
      ? 'Republican Primary'
      : race.primary_party === 'D'
        ? 'Democratic Primary'
        : 'Primary';

  const daysUntil = daysUntilLocalDate(race.election_date, nowMs);
  const dateLabel = formatLocalDate(race.election_date, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <Link
      href={`/scorecards/${race.id}`}
      className={`group bg-white border ${theme.border} rounded-2xl p-6 hover:shadow-lg transition`}
    >
      <div className="flex justify-between items-start mb-4">
        <span className={`text-xs font-semibold px-3 py-1 rounded-full ${theme.accent}`}>
          {partyName}
        </span>
        <div className="text-right">
          <p className="text-xs text-gray-400 font-medium">{dateLabel}</p>
          {daysUntil > 0 && (
            <p className={`text-xs font-bold ${theme.text}`}>
              {daysUntil} {daysUntil === 1 ? 'day' : 'days'}
            </p>
          )}
        </div>
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">
        {race.office}
        {race.district && ` — ${race.state}-${race.district}`}
        {!race.district && ` — ${race.state}`}
      </h2>
      <p className="text-sm text-gray-500 mb-5">
        {candidates.count === 0
          ? 'Candidate data being curated'
          : `${candidates.count} candidate${candidates.count === 1 ? '' : 's'}`}
      </p>
      <div className="flex items-center gap-3">
        {candidates.count > 0 && (
          <div className="flex -space-x-2">
            {candidates.sample.map((c) => (
              <div
                key={c.id}
                className={`w-8 h-8 rounded-full ${theme.avatarGradient} border-2 border-white flex items-center justify-center text-white text-[10px] font-bold`}
              >
                {c.name
                  .split(' ')
                  .slice(0, 2)
                  .map((p) => p[0])
                  .join('')
                  .toUpperCase()}
              </div>
            ))}
          </div>
        )}
        <span className={`ml-auto ${theme.text} font-semibold text-sm`}>
          Browse →
        </span>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 p-10 text-center">
      <p className="text-lg text-gray-700 font-medium mb-2">Florida only — for now</p>
      <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
        We&apos;re starting with the Florida primary on August 18, 2026 — House,
        Senate, and Governor. More states will follow based on demand.
      </p>
      <Link
        href="/"
        className="inline-block bg-blue-600 text-white font-medium px-6 py-3 rounded-lg hover:bg-blue-700"
      >
        Try a Florida zip →
      </Link>
    </div>
  );
}
