/** Loading fallback for /privacy. */
export default function PrivacyLoading() {
  return (
    <main
      className="max-w-3xl mx-auto px-4 lg:px-8 py-10 lg:py-14"
      role="status"
      aria-live="polite"
    >
      <div className="h-9 w-1/2 bg-gray-200 rounded mb-6 animate-pulse" />
      <div className="space-y-3">
        <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
        <div className="h-4 w-5/6 bg-gray-100 rounded animate-pulse" />
        <div className="h-4 w-2/3 bg-gray-100 rounded animate-pulse" />
      </div>
      <span className="sr-only">Loading…</span>
    </main>
  );
}
