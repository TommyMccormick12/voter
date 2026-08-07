'use client';

// Mounts once in the root layout. Reports a visit 'start' on every route
// change and a single 'end' on pagehide, feeding session_visits (Spec C2).
// Renders nothing.

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { trackVisitStart, trackVisitEnd } from '@/lib/visits-client';

export default function VisitTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname) trackVisitStart(pathname);
  }, [pathname]);

  useEffect(() => {
    const onPageHide = () => trackVisitEnd();
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  return null;
}
