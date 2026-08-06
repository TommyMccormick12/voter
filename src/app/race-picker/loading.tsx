/** Loading fallback for /race-picker while races + candidate samples fetch. */
export default function RacePickerLoading() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10 lg:py-12" role="status" aria-live="polite">
      <div className="h-3 w-16 bg-gray-200 rounded mb-3 animate-pulse" />
      <div className="h-9 w-3/4 bg-gray-200 rounded mb-2 animate-pulse" />
      <div className="h-5 w-1/2 bg-gray-200 rounded mb-8 animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-gray-200 p-6 h-40 animate-pulse bg-gray-50"
          />
        ))}
      </div>
      <span className="sr-only">Loading races…</span>
    </main>
  );
}
