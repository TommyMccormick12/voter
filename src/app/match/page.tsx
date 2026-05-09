import Link from 'next/link';
import { MatchFlow } from './MatchFlow';
import { getMockRace } from '@/lib/mock-data';
import { ISSUE_NAMES } from '@/lib/issues';

interface PageProps {
  searchParams: Promise<{ race?: string }>;
}

const TOP_5_ISSUES = ['economy', 'healthcare', 'immigration', 'climate', 'housing'];

/**
 * Match flow entry point — 2-step wizard backed by MatchFlow client component.
 *
 * Server component validates the race and prepares the issue list, then hands
 * off to the client wizard. This pattern keeps the heavy interaction client-only
 * while letting the server handle race lookups + 404s up front.
 */
export default async function MatchPage({ searchParams }: PageProps) {
  const { race: raceId } = await searchParams;

  if (!raceId) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          Pick a race first
        </h1>
        <p className="text-gray-500 mb-6">
          The match flow needs to know which race to compare you against.
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

  const race = getMockRace(raceId);
  if (!race) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-3">Race not found</h1>
        <p className="text-gray-500 mb-6">
          We don&apos;t have data for that race yet.
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

  const issues = TOP_5_ISSUES.map((slug) => ({
    slug,
    name: ISSUE_NAMES[slug] ?? slug,
  }));

  return <MatchFlow raceId={raceId} issues={issues} />;
}
