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

      <div className="space-y-4">
        <div className="border border-gray-200 rounded-lg p-6 hover:border-blue-300 transition-colors cursor-pointer">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                U.S. Senate
              </h2>
              <p className="text-gray-500 text-sm mt-1">
                Sample State &middot; 2026
              </p>
            </div>
            <span className="text-sm text-gray-400">3 candidates</span>
          </div>
        </div>
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
