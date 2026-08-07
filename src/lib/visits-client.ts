// Client-side visit tracker.
// Fires POST /api/visit. Fire-and-forget; errors logged, never thrown.
// Consent is enforced server-side in the route (drops silently without
// consent_analytics), matching interactions-client.ts.

export function trackVisitStart(path: string): void {
  if (typeof window === 'undefined') return;
  void fetch('/api/visit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'start', path }),
    keepalive: true,
  }).catch((err) => {
    console.warn('[visit] start dispatch failed', err);
  });
}

export function trackVisitEnd(): void {
  if (typeof window === 'undefined') return;
  const payload = JSON.stringify({ type: 'end' });
  // sendBeacon survives pagehide where fetch may be cancelled.
  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      '/api/visit',
      new Blob([payload], { type: 'application/json' })
    );
    return;
  }
  void fetch('/api/visit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch((err) => {
    console.warn('[visit] end dispatch failed', err);
  });
}
