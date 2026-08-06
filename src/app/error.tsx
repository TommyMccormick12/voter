'use client';

import Link from 'next/link';

/**
 * Root error boundary — catches unexpected errors from any page under
 * app/ that doesn't have a more specific error.tsx of its own. T16
 * (Spec C3). Honest, no stack traces or internals; offers retry via
 * this Next.js version's `unstable_retry` (re-fetches and re-renders
 * the segment without a full navigation).
 */
export default function GlobalErrorBoundary({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  if (process.env.NODE_ENV !== 'production') {
    console.error(error);
  }

  return (
    <main className="min-h-[calc(100svh-3.5rem)] flex flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-bold text-gray-900 mb-3">
        Something went wrong
      </h1>
      <p className="text-gray-500 mb-6 max-w-md">
        We hit a problem loading this page. It&apos;s on our end — try again,
        or head back to the homepage.
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
    </main>
  );
}
