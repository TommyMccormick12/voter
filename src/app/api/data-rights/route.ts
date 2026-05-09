import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { COOKIE_NAMES, readCookie } from '@/lib/cookies';
import {
  getVisitsForSession,
  getConsentHistory,
  purgeSession,
} from '@/lib/visit-tracker';
import { parseConsent } from '@/lib/consent';

/**
 * Right-to-know + right-to-delete endpoint.
 *
 * GET /api/data-rights → returns everything we have linked to this session
 * DELETE /api/data-rights → purges all rows linked to this session, anonymizes
 *                          consent audit entries (kept for regulator), clears
 *                          all our cookies
 *
 * Required by CCPA/CPRA, CO/CT/VA/UT privacy acts. The session_id IS the
 * pseudonymous identifier — we never collect email/name/phone, so there's
 * nothing else to verify.
 *
 * TODO (Chunk 6): when Supabase is wired, GET joins quick_poll_responses,
 * candidate_interactions, llm_matches, session_visits, consent_audit;
 * DELETE cascades through all those tables.
 */

const DeleteSchema = z.object({
  confirm: z.literal(true),
});

export async function GET() {
  const sessionId = await readCookie(COOKIE_NAMES.session);
  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: 'no_session' },
      { status: 401 }
    );
  }

  const consent = parseConsent(await readCookie(COOKIE_NAMES.consent));
  const visits = getVisitsForSession(sessionId);
  const consent_history = getConsentHistory(sessionId);

  // Strip raw session_id (and ip_hash) from nested rows. The user owns this
  // session and is looking at their own data, so leakage isn't a confidentiality
  // risk — but keeping the response free of the raw token is defense-in-depth
  // (downloaded JSON exports won't contain the live session token; logged
  // response bodies never expose it).
  const pseudonym = hash6(sessionId);
  const sanitizedVisits = visits.map((v) => ({
    id: v.id,
    session_id: pseudonym,
    visit_started_at: v.visit_started_at,
    visit_ended_at: v.visit_ended_at,
    pages_viewed: v.pages_viewed,
    ip_country: v.ip_country,
    ip_region: v.ip_region,
    user_agent_hash: v.user_agent_hash,
  }));
  const sanitizedConsent = consent_history.map((c) => ({
    id: c.id,
    session_id: pseudonym,
    consent_type: c.consent_type,
    granted: c.granted,
    granted_at: c.granted_at,
    user_agent_hash: c.user_agent_hash,
    // ip_hash intentionally omitted — even hashed, no need to surface
  }));

  // TODO (Chunk 6): also fetch
  //  - candidate_interactions WHERE session_id = ...
  //  - quick_poll_responses WHERE session_id = ...
  //  - llm_matches WHERE session_id = ...

  return NextResponse.json({
    ok: true,
    session_id_pseudonym: pseudonym,
    current_consent: consent,
    visits: sanitizedVisits,
    consent_history: sanitizedConsent,
    note: 'This is everything linked to your session token. We do not collect email, name, phone, or precise location.',
  });
}

export async function DELETE(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_json' },
      { status: 400 }
    );
  }

  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'must_confirm', message: 'Set {"confirm": true} to proceed.' },
      { status: 400 }
    );
  }

  const sessionId = await readCookie(COOKIE_NAMES.session);
  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: 'no_session' },
      { status: 401 }
    );
  }

  const purged = purgeSession(sessionId);

  // TODO (Chunk 6): cascade delete from candidate_interactions,
  //   quick_poll_responses, llm_matches, sessions table.

  // Clear all our cookies
  const response = NextResponse.json({
    ok: true,
    purged,
    message: 'Your data has been deleted. Cookies are cleared. You may close this tab.',
  });
  for (const name of Object.values(COOKIE_NAMES)) {
    response.cookies.set(name, '', { path: '/', maxAge: 0 });
  }
  return response;
}

function hash6(s: string): string {
  // Short pseudonym for display only. Not cryptographically meaningful.
  return s.slice(0, 6) + '...' + s.slice(-4);
}
