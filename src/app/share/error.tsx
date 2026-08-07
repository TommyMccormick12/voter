'use client';

import Link from 'next/link';

/** Route error boundary for /share. T16 (Spec C3). */
export default function ShareError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-white px-4 text-center">
      <div className="max-w-lg w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          We couldn&apos;t load this share link right now
        </h1>
        <p className="text-gray-500 mb-6">
          Something went wrong on our end. Try again in a moment.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="bg-blue-600 text-white font-medium px-6 py-3 rounded-lg hover:bg-blue-700"
          >
            Try again
          </button>
          <Link
            href="/"
            className="text-gray-600 font-medium px-6 py-3 rounded-lg hover:bg-gray-100"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
