'use client';

import { useState } from 'react';
import Link from 'next/link';
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
    router.push(`/race-picker?zip=${zip}`);
  }

  return (
    <div className="min-h-[calc(100svh-3.5rem)] bg-white flex flex-col items-center justify-center px-4">
      <main className="max-w-md w-full space-y-6">
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight text-balance">
          Find your candidates for the 2026 federal midterm primaries.
        </h1>
        <p className="text-lg text-gray-500 leading-relaxed">
          Browse who&apos;s running for House, Senate, and Governor. See where
          their money comes from and how they vote.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 pt-2">
          <label htmlFor="zip-input" className="sr-only">
            Zip code
          </label>
          <div className="flex gap-3">
            <input
              id="zip-input"
              type="text"
              value={zipCode}
              onChange={(e) => {
                setZipCode(e.target.value);
                setError('');
              }}
              placeholder="Your zip code"
              aria-describedby={error ? 'zip-error' : undefined}
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={10}
              inputMode="numeric"
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
            <p id="zip-error" role="alert" className="text-red-500 text-sm">{error}</p>
          )}
        </form>

        <p className="text-sm text-gray-400">
          Anonymous. No account needed.
        </p>

        {/* Fallback link to legacy /priorities flow until full pivot ships */}
        <p className="text-xs text-gray-300 pt-4 border-t border-gray-100">
          Want to rank issues instead?{' '}
          <Link
            href={`/priorities${zipCode ? `?zip=${zipCode}` : ''}`}
            className="text-gray-400 hover:text-gray-600 underline"
          >
            Use the old flow
          </Link>
        </p>
      </main>
    </div>
  );
}
