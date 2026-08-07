import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCandidateBySlug } from '@/lib/data/candidates';
import { getRace } from '@/lib/data/races';
import { CandidateDetail } from '@/components/CandidateDetail';
import { CandidateDetailActions } from '@/components/CandidateDetailActions';
import { ErrorState } from '@/components/ui/ErrorState';

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
        <CandidateDetailActions
          candidateId={candidate.id}
          candidateSlug={candidate.slug}
          raceId={candidate.race_id}
        />
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
    <ErrorState
      title="We couldn't load this candidate right now"
      retryHref={`/candidate/${slug}`}
      secondaryAction={
        <Link href="/race-picker" className="text-gray-600 font-medium px-6 py-3 rounded-lg hover:bg-gray-100">
          All races
        </Link>
      }
    />
  );
}
