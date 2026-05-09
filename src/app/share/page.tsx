import type { Metadata } from 'next';
import Link from 'next/link';
import { getIssueName } from '@/lib/issues';

interface SharePageProps {
  searchParams: Promise<{ r?: string; zip?: string; p?: string }>;
}

export async function generateMetadata({
  searchParams,
}: SharePageProps): Promise<Metadata> {
  const params = await searchParams;
  const rankings = (params.r || '').split(',').filter(Boolean);
  const zip = params.zip || '';
  const topIssue = getIssueName(rankings[0] || '');

  const ogParams = new URLSearchParams();
  if (params.r) ogParams.set('r', params.r);
  if (zip) ogParams.set('zip', zip);
  if (params.p) ogParams.set('p', params.p);

  const title = rankings.length > 0
    ? zip
      ? `Someone in ${zip} ranked ${topIssue} as #1`
      : `${topIssue} ranked #1`
    : 'Rank your priorities';

  return {
    title,
    description:
      'See how your priorities compare to your neighbors. Rank yours now.',
    openGraph: {
      images: [
        { url: `/api/og?${ogParams.toString()}`, width: 1200, height: 630 },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      images: [`/api/og?${ogParams.toString()}`],
    },
  };
}

export default async function SharePage({ searchParams }: SharePageProps) {
  const params = await searchParams;
  const rankings = (params.r || '').split(',').filter(Boolean);
  const zip = params.zip || '';
  const percentile = params.p;

  // No rankings — just show CTA
  if (rankings.length === 0) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-white px-4">
        <div className="max-w-lg w-full text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Rank your priorities
          </h1>
          <p className="text-gray-600 mb-8">
            See how your community&apos;s priorities are shifting.
          </p>
          <Link
            href="/"
            className="inline-block bg-blue-600 text-white font-semibold px-8 py-4 rounded-lg text-lg hover:bg-blue-700 transition-colors"
          >
            Rank your priorities &rarr;
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-white px-4 py-12">
      <div className="max-w-lg w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">
            {zip
              ? `Someone in ${zip} shared their priorities`
              : 'Someone shared their priorities'}
          </h1>
        </div>

        {/* Rankings card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <ol className="space-y-4">
            {rankings.map((slug, index) => (
              <li key={slug} className="flex items-center gap-4">
                <span className="text-blue-600 font-bold text-xl w-8">
                  {index + 1}.
                </span>
                <span className="text-gray-900 text-lg font-medium">
                  {getIssueName(slug)}
                </span>
              </li>
            ))}
          </ol>

          {/* Percentile callout */}
          {percentile && (
            <div className="mt-6 pt-4 border-t border-gray-100">
              <p className="text-blue-600 font-medium">
                {percentile}% of people{zip ? ` in ${zip}` : ''} agree
              </p>
            </div>
          )}
        </div>

        {/* CTA */}
        <div className="text-center">
          <Link
            href="/"
            className="inline-block bg-blue-600 text-white font-semibold px-8 py-4 rounded-lg text-lg hover:bg-blue-700 transition-colors"
          >
            Rank your priorities &rarr;
          </Link>
          <p className="mt-4 text-sm text-gray-500">
            See how your community&apos;s priorities are shifting
          </p>
        </div>
      </div>
    </main>
  );
}
