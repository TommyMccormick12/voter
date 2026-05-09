import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

const RequestSchema = z.object({
  race_id: z.string().min(1),
  responses: z
    .array(
      z.object({
        issue_slug: z.string().min(1),
        weight: z.number().int().min(1).max(5),
      })
    )
    .min(1)
    .max(20),
});

/**
 * POST /api/quick-poll
 *
 * Records issue-importance weights from the user's quick poll. Each (issue, weight)
 * tuple becomes a row in quick_poll_responses keyed by session_id and race_id.
 *
 * TODO (Chunk 5/6): wire to Supabase quick_poll_responses table, gate on
 * consent_analytics. This is the source data for the B2B district-level
 * issue-weight aggregation product.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_json' },
      { status: 400 }
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_payload', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // TODO (Chunk 5/6): insert into quick_poll_responses with session_id from cookie
  if (process.env.NODE_ENV !== 'production') {
    console.log(
      `[quick-poll] race=${parsed.data.race_id} responses=${parsed.data.responses.length}`
    );
  }

  return NextResponse.json({ ok: true, recorded: parsed.data.responses.length });
}
