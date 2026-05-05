'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function RacesContent() {
  const searchParams = useSearchParams();
  const zip = searchParams.get('zip');

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        {zip ? `Races near ${zip}` : 'All Races'}
      </h1>
      <p className="text-gray-600 mb-8">
        Select a race to compare candidates side-by-side.
      </p>

      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
        <p className="text-gray-500 text-lg mb-2">No races available yet</p>
        <p className="text-gray-400 text-sm">
          Race data for 2026 elections is coming soon. Enter your zip code on
          the{' '}
          <a href="/" className="text-blue-600 hover:text-blue-700 underline">
            homepage
          </a>{' '}
          to rank your priorities in the meantime.
        </p>
      </div>
    </div>
  );
}

export default function RacesPage() {
  return (
    <div className="min-h-screen bg-white px-4 py-12">
      <Suspense fallback={<div className="max-w-4xl mx-auto text-gray-400">Loading...</div>}>
        <RacesContent />
      </Suspense>
    </div>
  );
}
