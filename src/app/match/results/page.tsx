import Link from 'next/link';
import { MatchResults } from './MatchResults';
import { getRace } from '@/lib/data/races';
import { getCandidatesForRace } from '@/lib/data/candidates';

interface PageProps {
  searchParams: Promise<{ race?: string }>;
}

/**
 * Match results page — server validates the race, then hands off to the
 * MatchResults client component which reads the ranked results from
 * sessionStorage (set by MatchFlow).
 *
 * Why sessionStorage and not URL state: ranked results contain the user's
 * free-text + match rationales, which can be 1KB+. URLs aren't the right
 * channel for that.
 */
export default async function MatchResultsPage({ searchParams }: PageProps) {
  const { race: raceId } = await searchParams;

  if (!raceId) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-3">No race specified</h1>
        <Link
          href="/"
          className="inline-block bg-blue-600 text-white font-medium px-6 py-3 rounded-lg hover:bg-blue-700"
        >
          Go to homepage →
        </Link>
      </main>
    );
  }

  const race = await getRace(raceId);
  if (!race) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-3">Race not found</h1>
        <Link
          href="/"
          className="inline-block bg-blue-600 text-white font-medium px-6 py-3 rounded-lg hover:bg-blue-700"
        >
          Go to homepage →
        </Link>
      </main>
    );
  }

  const candidates = await getCandidatesForRace(raceId);

  return <MatchResults race={race} candidates={candidates} />;
}
