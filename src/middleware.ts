import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAMES, COOKIE_OPTIONS, generateSessionToken } from '@/lib/cookies';

/**
 * Middleware — runs on every request before any page or API route.
 *
 * Responsibilities:
 *   1. Issue a voter_session cookie on the first request from a new visitor.
 *      This is "functional" / strictly necessary, no consent required.
 *      Without it we couldn't link a user's swipes/poll across pages.
 *   2. Capture utm_* + referrer on first visit (read from URL, write to
 *      voter_utm cookie). Tier B data — but storing the cookie itself is
 *      cheap; analytics endpoints decide whether to actually USE the value
 *      based on consent_analytics.
 *
 * Skipped paths: Next.js internals, static assets, the public mockup HTML.
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // 1. Issue session cookie if missing
  if (!request.cookies.get(COOKIE_NAMES.session)) {
    response.cookies.set(
      COOKIE_NAMES.session,
      generateSessionToken(),
      COOKIE_OPTIONS.session
    );
  }

  // 2. First-touch attribution: capture UTM/referrer if voter_utm not yet set
  if (!request.cookies.get(COOKIE_NAMES.utm)) {
    const url = request.nextUrl;
    const utmSource = url.searchParams.get('utm_source');
    const utmMedium = url.searchParams.get('utm_medium');
    const utmCampaign = url.searchParams.get('utm_campaign');
    const referrer = request.headers.get('referer');

    // Only write if there's at least one piece of attribution data.
    if (utmSource || utmMedium || utmCampaign || referrer) {
      const payload = JSON.stringify({
        utm_source: utmSource ?? null,
        utm_medium: utmMedium ?? null,
        utm_campaign: utmCampaign ?? null,
        referrer_domain: referrer ? safeHost(referrer) : null,
        captured_at: new Date().toISOString(),
      });
      response.cookies.set(
        COOKIE_NAMES.utm,
        encodeURIComponent(payload),
        COOKIE_OPTIONS.utm
      );
    }
  }

  return response;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Skip Next.js internals, static files, mockup HTMLs, and the favicon.
 * Match all other routes including pages and API routes.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|mockup.*\\.html|.*\\.zip).*)',
  ],
};
