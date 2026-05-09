import Link from 'next/link';
import { DataRightsClient } from './DataRightsClient';

export const metadata = {
  title: 'Your data choices | voter',
  description:
    'Download or delete the data we have about you. Opt out of data sale anytime.',
};

export default function DataRightsPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 lg:px-8 py-10 lg:py-14">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Privacy controls
      </p>
      <h1 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-3">
        Your data choices
      </h1>
      <p className="text-base lg:text-lg text-gray-600 mb-8 leading-relaxed">
        We collect anonymous engagement data linked only to a session token in
        your browser cookies. No name, no email, no precise location. Below is
        everything we have on you, plus controls to download or delete it.
      </p>

      <DataRightsClient />

      <div className="mt-10 pt-6 border-t border-gray-200">
        <p className="text-sm text-gray-500">
          Read the full{' '}
          <Link href="/privacy" className="text-blue-600 underline">
            Privacy Policy
          </Link>{' '}
          or{' '}
          <Link href="/terms" className="text-blue-600 underline">
            Terms of Service
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
