import Link from 'next/link';
import { MatchResults } from './MatchResults';
import { getRace } from '@/lib/data/races';
import { getCandidatesForRace } from '@/lib/data/candidates';
import { getMatchById } from '@/lib/app/match';
import { COOKIE_NAMES, readCookie } from '@/lib/cookies';

interface PageProps {
  searchParams: Promise<{ m?: string; h?: string }>;
}

/**
 * Match results page — T17 (Spec C4). Results are keyed by the
 * persisted llm_matches row id (`?m=<id>`), fetched server-side, not by
 * sessionStorage. This is what makes the page survive a refresh or a
 * deep link: the id is a stable URL param, and the ranking lives in the
 * database instead of the browser's per-tab storage.
 *
 * getMatchById enforces access (Finding 2): a match row owned by a
 * different session 404s/403s here unless `h` (free_text_hash, from
 * the /api/match response — see MatchFlow.tsx) proves this requester
 * knows the exact input text. Either way, getMatchById already
 * withholds free_text from a row this session doesn't own — this page
 * only ever renders what it was handed.
 */
export default async function MatchResultsPage({ searchParams }: PageProps) {
  const { m: matchId, h: hash } = await searchParams;

  if (!matchId) {
    return (
      <EmptyState
        title="No match to show"
        body="Start the match flow to get your ranked results."
      />
    );
  }

  const sessionId = (await readCookie(COOKIE_NAMES.session)) ?? null;
  const matchResult = await getMatchById(matchId, sessionId, hash ?? null);

  if (!matchResult.ok) {
    if (matchResult.code === 'forbidden') {
      return (
        <EmptyState
          title="This match isn't yours"
          body="Match results are only viewable from the session that created them."
        />
      );
    }
    if (matchResult.code === 'not_found') {
      return (
        <EmptyState
          title="Match results not found"
          body="This link may be expired or invalid. Try running the match again."
        />
      );
    }
    return (
      <EmptyState
        title="Couldn't load your match"
        body="Something went wrong loading your results. Try again in a moment."
      />
    );
  }

  const { match } = matchResult;
  const raceResult = await getRace(match.raceId);
  if (!raceResult.ok) {
    return (
      <EmptyState
        title="Couldn't load this race"
        body="Something went wrong loading race data. Try again in a moment."
      />
    );
  }
  if (!raceResult.data) {
    return (
      <EmptyState title="Race not found" body="We don't have data for that race anymore." />
    );
  }

  const candidatesResult = await getCandidatesForRace(match.raceId);
  if (!candidatesResult.ok) {
    return (
      <EmptyState
        title="Couldn't load candidates"
        body="Something went wrong loading candidate data. Try again in a moment."
      />
    );
  }

  return <MatchResults race={raceResult.data} candidates={candidatesResult.data} match={match} />;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <main className="max-w-2xl mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-gray-900 mb-3">{title}</h1>
      <p className="text-gray-500 mb-6">{body}</p>
      <Link
        href="/"
        className="inline-block bg-blue-600 text-white font-medium px-6 py-3 rounded-lg hover:bg-blue-700"
      >
        Go to homepage →
      </Link>
    </main>
  );
}
