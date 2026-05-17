import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { COOKIE_NAMES, readCookie } from '@/lib/cookies';
import {
  CURRENT_CONSENT_VERSION,
  parseConsent,
  serializeConsent,
} from '@/lib/consent';
import { auditConsent } from '@/lib/visit-tracker';
import { clientIpFromHeaders, hashIp, hashUserAgent } from '@/lib/geo';
import { checkRateLimits, CONSENT_LIMITS } from '@/lib/rate-limit';
import type { ConsentState, ConsentType } from '@/types/database';

const ConsentRequestSchema = z.object({
  analytics: z.boolean(),
  data_sale: z.boolean(),
  marketing: z.boolean().optional().default(false),
});

const CONSENT_TYPES: ConsentType[] = ['analytics', 'data_sale', 'marketing'];

/**
 * POST /api/consent
 *
 * Sets/updates the user's consent. Writes:
 *  - voter_consent cookie (so client + server agree on consent state)
 *  - consent_audit entries for every type that changed
 *
 * The audit log is regulator-required (CCPA, CPRA, etc.). It's the proof
 * that we asked, the user answered, and what they said.
 *
 * TODO (Chunk 6): persist audit entries to Supabase consent_audit table.
 */
export async function POST(request: NextRequest) {
  // Rate limit first — consent writes go into the regulator-audit log.
  // A bot stuffing fake consent entries would create CCPA/CPRA noise that
  // makes a real subpoena harder to answer.
  const sessionForLimit = (await readCookie(COOKIE_NAMES.session)) ?? null;
  const ipForLimit = clientIpFromHeaders(request.headers);
  const rate = await checkRateLimits({
    sessionId: sessionForLimit,
    ip: ipForLimit,
    sessionLimit: CONSENT_LIMITS.session,
    ipLimit: CONSENT_LIMITS.ip,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited', scope: rate.exceeded, retry_after_seconds: rate.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_json' },
      { status: 400 }
    );
  }

  const parsed = ConsentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_payload', issues: parsed.error.flatten() },
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

  // Read previous consent so we can audit only the deltas
  const previousRaw = await readCookie(COOKIE_NAMES.consent);
  const previous = parseConsent(previousRaw);

  const next: ConsentState = {
    analytics: parsed.data.analytics,
    data_sale: parsed.data.data_sale,
    marketing: parsed.data.marketing,
    functional: true,
    version: CURRENT_CONSENT_VERSION,
    recorded_at: new Date().toISOString(),
  };

  // Audit only entries that changed (or all if no previous record)
  const ip = clientIpFromHeaders(request.headers);
  const ua = request.headers.get('user-agent');
  const ipHash = hashIp(ip);
  const uaHash = hashUserAgent(ua);

  for (const type of CONSENT_TYPES) {
    const prevValue = previous?.[type] ?? false;
    const nextValue = next[type];
    if (prevValue !== nextValue || previous === null) {
      auditConsent({
        session_id: sessionId,
        consent_type: type,
        granted: nextValue,
        ip_hash: ipHash,
        user_agent_hash: uaHash,
      });
    }
  }

  const response = NextResponse.json({ ok: true, consent: next });
  response.cookies.set(COOKIE_NAMES.consent, serializeConsent(next), {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    httpOnly: false, // client banner needs to read it
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

/**
 * GET /api/consent
 *
 * Returns current consent state (parsed from cookie). Useful for the
 * banner to decide whether to show.
 */
export async function GET() {
  const raw = await readCookie(COOKIE_NAMES.consent);
  const consent = parseConsent(raw);
  return NextResponse.json({ ok: true, consent });
}
