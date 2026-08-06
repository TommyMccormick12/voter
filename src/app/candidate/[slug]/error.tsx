'use client';

import Link from 'next/link';
import { ErrorState } from '@/components/ui/ErrorState';

/**
 * Route error boundary for /candidate/[slug] — catches uncaught
 * exceptions (bugs), not the typed DB-error path already handled
 * inline in page.tsx. T16 (Spec C3).
 */
export default function CandidateError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <ErrorState
      title="We couldn't load this candidate right now"
      onRetry={() => unstable_retry()}
      secondaryAction={
        <Link href="/race-picker" className="text-gray-600 font-medium px-6 py-3 rounded-lg hover:bg-gray-100">
          All races
        </Link>
      }
    />
  );
}
