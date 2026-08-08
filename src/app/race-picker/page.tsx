import Link from 'next/link';
import {
  getDistrictsForZip,
  getRacesForDistrict,
  getRacesForDistricts,
} from '@/lib/data/races';
import { getCandidateSamplesForRaces } from '@/lib/data/candidates';
import { getPartyTheme } from '@/lib/party-theme';
import { formatLocalDate, daysUntilLocalDate } from '@/lib/dates';
import { Badge, Button, Card, EmptyState, ErrorState } from '@/components/ui';
import { dataOk, type DataResult } from '@/lib/data/boundary';
import type { Race } from '@/types/database';
import { SplitZipAddressForm } from './SplitZipAddressForm';

interface PageProps {
  searchParams: Promise<{ zip?: string; district?: string; allDistricts?: string }>;
}

interface CandidateSample {
  count: number;
  sample: Array<{ id: string; name: string }>;
}

const RETRY_ERROR_TITLE = "We couldn't load races right now";
const RETRY_ERROR_DESCRIPTION =
  'Something went wrong on our end. Your zip code was fine — try again in a moment.';

/**
 * Race picker page — shows federal midterm primaries near the user's zip
 * (T06, Spec A3/A5).
 *
 * Zip stays in the URL as before. Single-district zips resolve straight
 * to a race list (unchanged UX). Split zips (the crosswalk lists more
 * than one district) show an address form instead of guessing — once
 * /api/district resolves an address to a district, the page carries
 * that as `?district=` so the flow survives a refresh without
 * sessionStorage. `?allDistricts=1` is the explicit, separately-chosen
 * fallback that shows every district's races at once; it is never the
 * default outcome of a skipped or failed address lookup.
 */
export default async function RacePickerPage({ searchParams }: PageProps) {
  const { zip, district: districtParam, allDistricts } = await searchParams;

  if (!zip) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-3">No zip code provided</h1>
        <p className="text-gray-500 mb-6">
          Enter your zip code on the homepage to find your primary races.
        </p>
        <Button href="/">Go to homepage →</Button>
      </main>
    );
  }

  const resolution = getDistrictsForZip(zip);

  if (resolution.kind === 'out_of_coverage') {
    return (
      <main className="max-w-3xl mx-auto px-4 py-10 lg:py-12">
        <ZipHeading zip={zip} raceCount={0} />
        <OutOfCoverageEmptyState />
      </main>
    );
  }

  // Split zip, no resolved district yet, and the user hasn't chosen the
  // "show all" fallback: ask for a street address instead of guessing.
  const resolvedDistrict =
    resolution.kind === 'split' && districtParam && resolution.districts.includes(districtParam)
      ? districtParam
      : null;
  const showAllDistricts = resolution.kind === 'split' && allDistricts === '1';

  if (resolution.kind === 'split' && !resolvedDistrict && !showAllDistricts) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-10 lg:py-12">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Zip {zip}
        </p>
        <h1 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-2">
          This zip crosses a district line
        </h1>
        <p className="text-base lg:text-lg text-gray-500 mb-8">
          House and Senate · Florida primary August 18, 2026
        </p>
        <SplitZipAddressForm zip={zip} districtCount={resolution.districts.length} />
      </main>
    );
  }

  let racesResult: DataResult<Race[]>;
  let headerNote: string | null = null;

  if (resolution.kind === 'single') {
    racesResult = await getRacesForDistrict(resolution.district);
  } else if (showAllDistricts && resolution.kind === 'split') {
    racesResult = await getRacesForDistricts(resolution.districts);
    headerNote = `Showing races for all ${resolution.districts.length} districts that overlap zip ${zip}, since we don't have your exact district yet.`;
  } else if (resolvedDistrict) {
    racesResult = await getRacesForDistrict(resolvedDistrict);
  } else {
    // Unreachable: the split-zip-no-resolution branch above already
    // returned the address form. Kept only so racesResult is always
    // assigned for TypeScript's control-flow analysis.
    racesResult = dataOk([]);
  }

  if (!racesResult.ok) {
    return (
      <ErrorState
        title={RETRY_ERROR_TITLE}
        description={RETRY_ERROR_DESCRIPTION}
        retryHref={`/race-picker?zip=${zip}`}
      />
    );
  }

  const races = racesResult.data;
  // Single batch query for all race candidate samples — keeps RaceCard
  // free of per-card fetches (the mock implementation hid an N+1 here).
  const samplesResult = await getCandidateSamplesForRaces(races.map((r) => r.id));

  if (!samplesResult.ok) {
    return (
      <ErrorState
        title={RETRY_ERROR_TITLE}
        description={RETRY_ERROR_DESCRIPTION}
        retryHref={`/race-picker?zip=${zip}`}
      />
    );
  }

  const samples = samplesResult.data;
  // Server component runs per request; "days until" is computed once here
  // and threaded down to RaceCard so the inner component stays pure.
  // eslint-disable-next-line react-hooks/purity -- server component, intentional per-request value
  const nowMs = Date.now();

  return (
    <main className="max-w-3xl mx-auto px-4 py-10 lg:py-12">
      <ZipHeading zip={zip} raceCount={races.length} />
      {headerNote && (
        <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-card px-4 py-3 mb-6">
          {headerNote}
        </p>
      )}

      {races.length === 0 ? (
        <CuratingEmptyState />
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

function ZipHeading({ zip, raceCount }: { zip: string; raceCount: number }) {
  return (
    <>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Zip {zip}
      </p>
      <h1 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-2">
        {raceCount === 0
          ? 'No federal primaries found'
          : raceCount === 1
            ? '1 federal primary near you'
            : `${raceCount} federal primaries near you`}
      </h1>
      <p className="text-base lg:text-lg text-gray-500 mb-8">
        House and Senate · Florida primary August 18, 2026
      </p>
    </>
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

  // Spec A5 / T06: an unopposed qualifier is never hidden and never
  // presented as a fake contest — the race card says so plainly and
  // still links to the scorecard.
  if (race.no_primary) {
    const note =
      race.no_primary_note ?? 'No primary — the qualified candidate advances unopposed.';
    return (
      <Card as="article" border={false} className={`group border ${theme.border}`}>
        <div className="flex justify-between items-start mb-4">
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${theme.accent}`}>
            {partyName}
          </span>
          <Badge tone="info">No primary</Badge>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">
          {race.office}
          {race.district && ` — ${race.state}-${race.district}`}
          {!race.district && ` — ${race.state}`}
        </h2>
        <p className="text-sm text-gray-600 mb-5">{note}</p>
        <Link href={`/scorecards/${race.id}`} className={`${theme.text} font-semibold text-sm`}>
          View scorecard →
        </Link>
      </Card>
    );
  }

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
        {/* "with policy data" is load-bearing, not filler. This count is the
            profiled count, not the ballot count — the roster holds qualified
            candidates we have not profiled yet. A bare "2 candidates" would
            state a ballot size that is often wrong. */}
        {candidates.count === 0
          ? 'Candidate data being curated'
          : `${candidates.count} candidate${candidates.count === 1 ? '' : 's'} with policy data`}
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

/**
 * Filtered-empty state: the zip is outside FL district coverage. This
 * is a filter mismatch, not missing data — distinct from
 * CuratingEmptyState below.
 */
function OutOfCoverageEmptyState() {
  return (
    <EmptyState
      title="Florida only — for now"
      description="We're starting with the Florida primary on August 18, 2026 — House and Senate. More states will follow based on demand."
      action={<Button href="/">Try a Florida zip →</Button>}
    />
  );
}

/**
 * Empty-data state: the zip maps to an FL district, but no races are
 * seeded for it yet. Distinct from OutOfCoverageEmptyState above.
 */
function CuratingEmptyState() {
  return (
    <EmptyState
      title="Curating — check back soon"
      description="We don't have race data for your district loaded yet. We're working through the Florida primary ballot district by district."
      action={<Button href="/">Try another zip →</Button>}
    />
  );
}
