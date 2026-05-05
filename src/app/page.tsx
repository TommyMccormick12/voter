'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getOrCreateSession, setSessionLocation } from '@/lib/session';

const ZIP_REGEX = /^\d{5}(-\d{4})?$/;

export default function Home() {
  const [zipCode, setZipCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const zip = zipCode.trim();

    if (!ZIP_REGEX.test(zip)) {
      setError('Enter a valid 5-digit zip code');
      return;
    }

    setError('');
    setLoading(true);

    const token = await getOrCreateSession();
    await setSessionLocation(token, zip);
    router.push(`/priorities?zip=${zip}`);
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
      <main className="max-w-lg w-full text-center space-y-8">
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">
          What Does Your Community Care About?
        </h1>
        <p className="text-lg text-gray-600">
          Rank the issues that matter most to you. See how your priorities
          compare to your neighbors.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col items-center gap-3 max-w-sm mx-auto">
          <div className="flex gap-3 w-full">
            <input
              type="text"
              value={zipCode}
              onChange={(e) => {
                setZipCode(e.target.value);
                setError('');
              }}
              placeholder="Enter your zip code"
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={10}
            />
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {loading ? '...' : 'Go'}
            </button>
          </div>
          {error && (
            <p className="text-red-500 text-sm">{error}</p>
          )}
        </form>

        <div className="pt-8 border-t border-gray-100">
          <p className="text-sm text-gray-500 mb-4">Or explore</p>
          <a
            href="/races"
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            All Races
          </a>
        </div>
      </main>
    </div>
  );
}
