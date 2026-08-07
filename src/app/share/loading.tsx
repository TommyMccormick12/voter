/** Loading fallback for /share. */
export default function ShareLoading() {
  return (
    <main
      className="min-h-screen flex items-center justify-center bg-white px-4"
      role="status"
      aria-live="polite"
    >
      <div className="max-w-lg w-full">
        <div className="h-6 w-2/3 mx-auto bg-gray-200 rounded mb-6 animate-pulse" />
        <div className="h-48 bg-gray-100 rounded-2xl animate-pulse" />
      </div>
      <span className="sr-only">Loading…</span>
    </main>
  );
}
