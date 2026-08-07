/** Loading fallback for /scorecards/[raceId] while race + candidates fetch. */
export default function ScorecardsLoading() {
  return (
    <main
      className="max-w-7xl mx-auto px-4 lg:px-8 py-6 lg:py-10"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 mb-8">
        <div className="h-4 w-16 bg-gray-200 rounded animate-pulse" />
        <div>
          <div className="h-5 w-40 bg-gray-200 rounded mb-2 animate-pulse" />
          <div className="h-3 w-28 bg-gray-200 rounded animate-pulse" />
        </div>
      </div>
      <div className="hidden lg:grid lg:grid-cols-4 gap-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-gray-200 h-96 animate-pulse bg-gray-50" />
        ))}
      </div>
      <div className="lg:hidden rounded-2xl border border-gray-200 h-96 animate-pulse bg-gray-50" />
      <span className="sr-only">Loading scorecards…</span>
    </main>
  );
}
