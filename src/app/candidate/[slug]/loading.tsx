/** Loading fallback for /candidate/[slug] while the full record fetches. */
export default function CandidateLoading() {
  return (
    <main className="max-w-7xl mx-auto px-4 lg:px-8" role="status" aria-live="polite">
      <div className="pt-4 flex items-center justify-between">
        <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
        <div className="h-8 w-32 bg-gray-200 rounded animate-pulse" />
      </div>
      <div className="mt-6 h-40 bg-gray-100 rounded-2xl animate-pulse" />
      <div className="mt-6 space-y-3">
        <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
        <div className="h-4 w-5/6 bg-gray-100 rounded animate-pulse" />
        <div className="h-4 w-2/3 bg-gray-100 rounded animate-pulse" />
      </div>
      <span className="sr-only">Loading candidate…</span>
    </main>
  );
}
