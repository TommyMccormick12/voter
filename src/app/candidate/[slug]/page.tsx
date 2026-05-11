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
  const candidate = await getCandidateBySlug(slug);

  if (!candidate) notFound();

  // Find the race so we can show a back link
  const race = candidate.race_id ? await getRace(candidate.race_id) : null;

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
