import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

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
  try {
    const body = await request.json();
    const parsed = InteractionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'invalid_payload', issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // TODO (Chunk 5/6): insert into candidate_interactions, gated on consent_analytics
    // For now, log so we can verify the client is dispatching correctly.
    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `[interaction] candidate=${parsed.data.candidate_id} race=${parsed.data.race_id} action=${parsed.data.action} dwell=${parsed.data.dwell_ms ?? 'n/a'}ms`
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[interaction] error', err);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
