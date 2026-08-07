/** Loading fallback for /data-rights. */
export default function DataRightsLoading() {
  return (
    <main
      className="max-w-3xl mx-auto px-4 lg:px-8 py-10 lg:py-14"
      role="status"
      aria-live="polite"
    >
      <div className="h-3 w-32 bg-gray-200 rounded mb-3 animate-pulse" />
      <div className="h-9 w-1/2 bg-gray-200 rounded mb-4 animate-pulse" />
      <div className="h-4 w-full bg-gray-100 rounded mb-2 animate-pulse" />
      <div className="h-4 w-5/6 bg-gray-100 rounded mb-8 animate-pulse" />
      <div className="h-40 bg-gray-50 border border-gray-200 rounded-xl animate-pulse" />
      <span className="sr-only">Loading…</span>
    </main>
  );
}
