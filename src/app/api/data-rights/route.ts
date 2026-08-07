import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { COOKIE_NAMES, readCookie } from '@/lib/cookies';
import { exportSessionData, deleteSessionData } from '@/lib/app/data-rights';
import { getConsentHistory, purgeConsentAudit } from '@/lib/visit-tracker';
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
 * Session ownership: both handlers derive the session solely from the
 * httpOnly voter_session cookie (never a client-supplied id), then the
 * application module (src/lib/app/data-rights.ts) resolves that token to
 * its `sessions` row before touching any of the four T15 tables
 * (candidate_interactions, quick_poll_responses, session_visits,
 * llm_matches). A request can only ever read/delete its own data.
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
  const consent_history = getConsentHistory(sessionId);

  const exported = await exportSessionData(sessionId);
  if (!exported.ok) {
    console.error('[api/data-rights] export failed:', exported.code, exported.detail);
    return NextResponse.json(
      { ok: false, error: exported.code },
      { status: exported.status }
    );
  }

  // Strip raw session_id (and ip_hash) from nested rows. The user owns this
  // session and is looking at their own data, so leakage isn't a confidentiality
  // risk — but keeping the response free of the raw token is defense-in-depth
  // (downloaded JSON exports won't contain the live session token; logged
  // response bodies never expose it).
  const pseudonym = hash6(sessionId);
  const sanitizedConsent = consent_history.map((c) => ({
    id: c.id,
    session_id: pseudonym,
    consent_type: c.consent_type,
    granted: c.granted,
    granted_at: c.granted_at,
    user_agent_hash: c.user_agent_hash,
    // ip_hash intentionally omitted — even hashed, no need to surface
  }));

  return NextResponse.json({
    ok: true,
    session_id_pseudonym: pseudonym,
    current_consent: consent,
    interactions: exported.data.interactions,
    quick_poll_responses: exported.data.quickPollResponses,
    visits: exported.data.visits,
    matches: exported.data.matches,
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

  const deleted = await deleteSessionData(sessionId);
  if (!deleted.ok) {
    console.error('[api/data-rights] delete failed:', deleted.code, deleted.detail);
    return NextResponse.json(
      { ok: false, error: deleted.code },
      { status: deleted.status }
    );
  }

  // consent_audit isn't one of the four T15 tables and stays in-memory
  // (written by /api/consent, outside this ticket's scope) — anonymize
  // its entries for this session same as before.
  const auditPurge = purgeConsentAudit(sessionId);

  // Clear all our cookies
  const response = NextResponse.json({
    ok: true,
    purged: { ...deleted.purged, consent_events: auditPurge.consent_events },
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
