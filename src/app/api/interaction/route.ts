import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { COOKIE_NAMES, readCookie } from '@/lib/cookies';
import { parseConsent } from '@/lib/consent';

const InteractionSchema = z.object({
  candidate_id: z.string().min(1),
  race_id: z.string().min(1),
  action: z.enum([
    'viewed',
    'saved',
    'unsaved',
    'viewed_detail',
    'viewed_donors',
    'viewed_votes',
    'viewed_statements',
    'source_clicked',
    'no_action',
  ]),
  view_order: z.number().int().nullable().optional(),
  dwell_ms: z.number().int().nullable().optional(),
});

/**
 * POST /api/interaction
 *
 * Records a user interaction with a candidate scorecard. Cheap, fire-and-forget.
 * Called by `trackInteraction` in src/lib/interactions-client.ts.
 *
 * TODO (Chunk 5/6): wire up to Supabase candidate_interactions table.
 * Currently a logging stub — preserves the contract so the client code works
 * before the database layer is wired up.
 */
export async function POST(request: NextRequest) {
  // JSON parse is a separate concern from validation: bad JSON is a client
  // error (400), not a server error (500). Without this split, malformed
  // POSTs from buggy clients pollute the 5xx error budget.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_json' },
      { status: 400 }
    );
  }

  const parsed = InteractionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_payload', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Consent gate: explicit opt-out drops the row silently with 200.
  const consent = parseConsent(await readCookie(COOKIE_NAMES.consent));
  if (consent && !consent.analytics) {
    return NextResponse.json({ ok: true, dropped: 'consent' });
  }

  // TODO (Chunk 6): insert into candidate_interactions table
  if (process.env.NODE_ENV !== 'production') {
    console.log(
      `[interaction] candidate=${parsed.data.candidate_id} race=${parsed.data.race_id} action=${parsed.data.action} dwell=${parsed.data.dwell_ms ?? 'n/a'}ms`
    );
  }

  return NextResponse.json({ ok: true });
}
