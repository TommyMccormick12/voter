interface ComparePageProps {
  params: Promise<{ candidateA: string; candidateB: string }>;
}

export default async function ComparePage({ params }: ComparePageProps) {
  const { candidateA, candidateB } = await params;

  return (
    <div className="min-h-screen bg-white px-4 py-12">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8 text-center">
          Candidate Comparison
        </h1>

        {/* Side-by-side comparison layout */}
        <div className="grid grid-cols-2 gap-8">
          {/* Candidate A */}
          <div className="text-center">
            <div className="w-24 h-24 bg-gray-200 rounded-full mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900">
              {decodeURIComponent(candidateA)}
            </h2>
            <p className="text-gray-500 text-sm">Party</p>
          </div>

          {/* Candidate B */}
          <div className="text-center">
            <div className="w-24 h-24 bg-gray-200 rounded-full mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900">
              {decodeURIComponent(candidateB)}
            </h2>
            <p className="text-gray-500 text-sm">Party</p>
          </div>
        </div>

        {/* Issue-by-issue comparison */}
        <div className="mt-12 space-y-6">
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-center text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">
              Issue Comparison
            </h3>
            <p className="text-center text-gray-400">
              Positions will appear here once candidate data is loaded.
            </p>
          </div>
        </div>

        {/* Who do you prefer? */}
        <div className="mt-12 text-center border-t border-gray-200 pt-8">
          <p className="text-gray-700 font-medium mb-4">
            Based on what you&apos;ve seen, who do you prefer?
          </p>
          <div className="flex gap-4 justify-center">
            <button className="px-6 py-3 border-2 border-blue-600 text-blue-600 font-medium rounded-lg hover:bg-blue-50 transition-colors">
              {decodeURIComponent(candidateA)}
            </button>
            <button className="px-6 py-3 border-2 border-blue-600 text-blue-600 font-medium rounded-lg hover:bg-blue-50 transition-colors">
              {decodeURIComponent(candidateB)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
