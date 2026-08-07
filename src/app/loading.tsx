/**
 * Root loading fallback — shown while a page under app/ streams in,
 * unless a more specific loading.tsx applies. T16 (Spec C3).
 */
export default function RootLoading() {
  return (
    <main
      className="min-h-[calc(100svh-3.5rem)] flex items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <p className="text-gray-400 text-sm">Loading…</p>
    </main>
  );
}
