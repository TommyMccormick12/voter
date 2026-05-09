import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMockCandidateBySlug, getMockRace } from '@/lib/mock-data';
import { CandidateDetail } from '@/components/CandidateDetail';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Candidate detail page — full record (stances, donors, voting, statements).
 *
 * TODO (Chunk 6): swap mock-data calls for Supabase queries that fetch
 * candidate + positions + donors + top_industries + voting_record + statements.
 */
export default async function CandidatePage({ params }: PageProps) {
  const { slug } = await params;
  const candidate = getMockCandidateBySlug(slug);

  if (!candidate) notFound();

  // Find the race so we can show a back link
  const race = candidate.race_id ? getMockRace(candidate.race_id) : null;

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
