import type { Metadata } from 'next';
import Link from 'next/link';
import { getRace } from '@/lib/data/races';
import { getCandidatesForRace } from '@/lib/data/candidates';
import { getPartyTheme, getPartyInitials } from '@/lib/party-theme';

interface SharePageProps {
  searchParams: Promise<{ race?: string; c?: string; s?: string }>;
}

/**
 * Share page for a personalized match result.
 *
 * URL shape: /share?race=<raceId>&c=<candidateSlug>&s=<score 0-100>
 *
 * Renders a party-themed card showing "Someone matched [Candidate]" with
 * the score and a CTA back to the match flow. Also generates OG/Twitter
 * metadata that points at /api/og with the same params.
 */
export async function generateMetadata({
  searchParams,
}: SharePageProps): Promise<Metadata> {
  const params = await searchParams;
  const raceId = params.race ?? '';
  const slug = params.c ?? '';
  const score = clampScore(params.s);

  const race = raceId ? await getRace(raceId) : null;
  // Cross-validate: candidate must belong to the named race.
  // A bare global lookup would let /share?race=race-nj-07&c=mark-warner render
  // a Democrat inside an NJ-07 (R) header. Filter to the race's roster instead.
  const candidate =
    raceId && slug
      ? (await getCandidatesForRace(raceId)).find((c) => c.slug === slug) ?? null
      : null;

  const ogParams = new URLSearchParams();
  if (raceId) ogParams.set('race', raceId);
  if (slug) ogParams.set('c', slug);
  if (score != null) ogParams.set('s', String(score));

  const title =
    candidate && race
      ? `${candidate.name} — ${score ?? '—'}% match in ${raceLabel(race)}`
      : 'Find your match in your 2026 primary';

  const description = candidate
    ? `Someone matched ${candidate.name} in their primary. Take 60 seconds to find your own match.`
    : 'Compare candidates in your 2026 federal primary on stances, donors, and voting record.';

  const ogUrl = `/api/og?${ogParams.toString()}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogUrl],
    },
  };
}

export default async function SharePage({ searchParams }: SharePageProps) {
  const params = await searchParams;
  const raceId = params.race ?? '';
  const slug = params.c ?? '';
  const score = clampScore(params.s);

  const race = raceId ? await getRace(raceId) : null;
  // Cross-validate: candidate must belong to the named race.
  // A bare global lookup would let /share?race=race-nj-07&c=mark-warner render
  // a Democrat inside an NJ-07 (R) header. Filter to the race's roster instead.
  const candidate =
    raceId && slug
      ? (await getCandidatesForRace(raceId)).find((c) => c.slug === slug) ?? null
      : null;

  // No match in URL — show the generic invite.
  if (!race || !candidate) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-white px-4">
        <div className="max-w-lg w-full text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Find your match
          </h1>
          <p className="text-gray-600 mb-8">
            Compare 2026 primary candidates on stances, donors, and voting
            record — in 60 seconds.
          </p>
          <Link
            href="/"
            className="inline-block bg-blue-600 text-white font-semibold px-8 py-4 rounded-lg text-lg hover:bg-blue-700 transition-colors"
          >
            Start now &rarr;
          </Link>
        </div>
      </main>
    );
  }

  const theme = getPartyTheme(candidate.primary_party);

  return (
    <main className="min-h-screen flex items-center justify-center bg-white px-4 py-12">
      <div className="max-w-lg w-full">
        <div className="text-center mb-6">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Match shared from voter
          </p>
          <h1 className="text-2xl font-bold text-gray-900">
            Someone&apos;s top match in {raceLabel(race)}
          </h1>
        </div>

        <div
          className={`${theme.heroBg} border-2 ${theme.border} rounded-2xl p-6 mb-6`}
        >
          <div className="flex items-center gap-4 mb-4">
            <div
              className={`w-16 h-16 rounded-full ${theme.avatarGradient} flex items-center justify-center text-white text-xl font-bold flex-shrink-0`}
              aria-hidden="true"
            >
              {getPartyInitials(candidate.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p
                className={`text-xs font-bold ${theme.text} uppercase tracking-wide`}
              >
                Top match
              </p>
              <h2 className="text-xl font-bold text-gray-900 leading-tight">
                {candidate.name}
              </h2>
              <p className="text-sm text-gray-700">
                {theme.label} · {candidate.incumbent ? 'Incumbent' : 'Challenger'}
              </p>
            </div>
            {score != null && (
              <div className={`text-3xl font-bold ${theme.text}`}>
                {score}%
              </div>
            )}
          </div>
          <Link
            href={`/candidate/${candidate.slug}`}
            className={`inline-block w-full text-center font-medium px-5 py-3 rounded-lg ${theme.accent}`}
          >
            See full record &rarr;
          </Link>
        </div>

        <div className="text-center">
          <Link
            href="/"
            className="inline-block bg-gray-900 text-white font-semibold px-8 py-4 rounded-lg text-lg hover:bg-gray-800 transition-colors"
          >
            Find your own match &rarr;
          </Link>
          <p className="mt-4 text-sm text-gray-500">
            60 seconds. No signup. Anonymous.
          </p>
        </div>
      </div>
    </main>
  );
}

function clampScore(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function raceLabel(race: { office: string; state: string; district: string | null; primary_party: string | null }): string {
  const seat = race.district ? `${race.state}-${race.district}` : race.state;
  const party =
    race.primary_party === 'R'
      ? 'R'
      : race.primary_party === 'D'
        ? 'D'
        : '';
  const partyTag = party ? ` (${party})` : '';
  return `${race.office} ${seat}${partyTag}`;
}
