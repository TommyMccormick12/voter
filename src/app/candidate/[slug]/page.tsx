import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCandidateBySlug } from '@/lib/data/candidates';
import { getRace } from '@/lib/data/races';
import { CandidateDetail } from '@/components/CandidateDetail';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Candidate detail page — full record (stances, donors, voting, statements).
 * One PostgREST round-trip via getCandidateBySlug pulls every child
 * relation; voting_record is capped at 50 most-recent rows.
 */
export default async function CandidatePage({ params }: PageProps) {
  const { slug } = await params;
  const candidateResult = await getCandidateBySlug(slug);

  if (!candidateResult.ok) {
    return <CandidateErrorState slug={slug} />;
  }

  const candidate = candidateResult.data;
  if (!candidate) notFound();

  // Find the race so we can show a back link. This is secondary
  // content — if it fails, degrade to a generic back link rather than
  // failing the whole page; the candidate record above is the primary
  // content this route exists to show.
  const raceResult = candidate.race_id ? await getRace(candidate.race_id) : null;
  const race = raceResult?.ok ? raceResult.data : null;

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 lg:px-8 pt-4 flex items-center justify-between">
        <Link
          href={race ? `/scorecards/${race.id}` : '/race-picker'}
          className="text-gray-500 text-sm font-medium hover:text-gray-900"
        >
          ← Back to scorecards
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-sm text-gray-600 px-4 py-2 hover:bg-gray-100 rounded-lg"
            aria-label="Save candidate"
          >
            ★ Save
          </button>
          <button
            type="button"
            className="text-sm text-gray-600 px-4 py-2 hover:bg-gray-100 rounded-lg"
            aria-label="Share candidate"
          >
            Share
          </button>
        </div>
      </div>
      <CandidateDetail candidate={candidate} />
    </>
  );
}

/**
 * Error state: the read itself failed (DB outage or config problem),
 * distinct from "no such candidate" (which renders `notFound()`).
 * Retry re-navigates to this same URL, which re-runs the server-side
 * data fetch.
 */
function CandidateErrorState({ slug }: { slug: string }) {
  return (
    <main className="max-w-2xl mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-gray-900 mb-3">
        We couldn&apos;t load this candidate right now
      </h1>
      <p className="text-gray-500 mb-6">
        Something went wrong on our end. Try again in a moment.
      </p>
      <div className="flex items-center justify-center gap-3">
        <Link
          href={`/candidate/${slug}`}
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
