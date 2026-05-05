import Link from 'next/link';

export function Nav() {
  return (
    <nav className="w-full border-b border-gray-100 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="text-lg font-bold text-gray-900 tracking-tight hover:text-blue-600 transition-colors"
        >
          voter
        </Link>
        <Link
          href="/races"
          className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors px-3 py-2 rounded-md hover:bg-gray-50"
        >
          All Races
        </Link>
      </div>
    </nav>
  );
}
