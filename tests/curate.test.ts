// Unit tests for src/lib/llm/curate.ts (T23, SPEC-2026-08-06.md E3).
//
// curate.ts exercises citation validation and JSON extraction as internal
// (unexported) helpers reached only through the public synthesizeStances
// entry point, so these tests drive it end-to-end with a mocked Anthropic
// client and assert on the resulting throw/resolve behavior. This module
// has no 'server-only' import, so no stub is needed for that.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CandidateRawData } from '@/lib/llm/curate';

const { messagesCreateMock } = vi.hoisted(() => ({
  messagesCreateMock: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return { messages: { create: messagesCreateMock } };
  }),
}));

function haikuTextResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

const candidate: CandidateRawData = {
  slug: 'jane-doe',
  name: 'Jane Doe',
  party: 'D',
  bio: null,
  key_messages: ['Lower costs for families'],
  campaign_themes: [],
  voting_record: [
    {
      bill_id: 'hr7567-119',
      bill_title: 'Test Appropriations Act',
      vote_question: 'On Motion to Recommit',
      roll_call_id: 'house-119-2-410',
      bill_summary: null,
      vote: 'nay',
      issue_slugs: ['economy'],
      vote_date: '2025-03-01',
    },
    {
      bill_id: 'hr7567-119',
      bill_title: 'Test Appropriations Act',
      vote_question: 'On Passage',
      roll_call_id: 'house-119-2-411',
      bill_summary: null,
      vote: 'yea',
      issue_slugs: ['economy'],
      vote_date: '2025-03-01',
    },
  ],
  statements: [
    {
      id: 'stmt-1',
      statement_text: 'I will fight for lower costs.',
      statement_date: '2025-01-15',
      issue_slugs: ['economy'],
    },
  ],
  top_industries: [],
};

const validStance = {
  issue_slug: 'economy',
  stance: 'support',
  summary: 'Supports lowering costs for families.',
  confidence: 80,
};

describe('synthesizeStances — citation validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it('uses roll_call_id to select one exact vote when a bill has opposed roll calls', async () => {
    messagesCreateMock.mockResolvedValue(
      haikuTextResponse(
        JSON.stringify({
          top_stances: [
            {
              ...validStance,
              track_record_note:
                'Voted NAY on the procedural motion (house-119-2-410).',
              track_record_citations: ['house-119-2-410'],
            },
          ],
        }),
      ),
    );

    const { synthesizeStances } = await import('@/lib/llm/curate');
    const result = await synthesizeStances(candidate);
    expect(result.top_stances).toHaveLength(1);
    expect(result.top_stances[0].track_record_citations).toEqual(['house-119-2-410']);

    const request = messagesCreateMock.mock.calls[0][0];
    const prompt = request.messages[0].content as string;
    expect(prompt).toContain('roll_call_id="house-119-2-410"');
    expect(prompt).toContain('roll_call_id="house-119-2-411"');
    expect(prompt).toContain('house-119-2-410" | bill_id="hr7567-119" [PROCEDURAL]');
  });

  it('accepts a citation that references a real statement_id from the input', async () => {
    messagesCreateMock.mockResolvedValue(
      haikuTextResponse(
        JSON.stringify({
          top_stances: [
            {
              ...validStance,
              track_record_note: 'Consistent with public statement.',
              track_record_citations: ['stmt-1'],
            },
          ],
        }),
      ),
    );

    const { synthesizeStances } = await import('@/lib/llm/curate');
    const result = await synthesizeStances(candidate);
    expect(result.top_stances[0].track_record_citations).toEqual(['stmt-1']);
  });

  it('throws BEFORE resolving on a fabricated explicit citation', async () => {
    messagesCreateMock.mockResolvedValue(
      haikuTextResponse(
        JSON.stringify({
          top_stances: [
            {
              ...validStance,
              track_record_note: 'Voted YES on a bill that does not exist.',
              track_record_citations: ['house-119-2-999'], // not in voting_record or statements
            },
          ],
        }),
      ),
    );

    const { synthesizeStances } = await import('@/lib/llm/curate');
    await expect(synthesizeStances(candidate)).rejects.toThrow(
      /Refusing fabricated citation/,
    );
  });

  it('rejects a bill_id citation even when that bill exists in the input', async () => {
    messagesCreateMock.mockResolvedValue(
      haikuTextResponse(
        JSON.stringify({
          top_stances: [
            {
              ...validStance,
              track_record_note: 'Voted on hr7567-119.',
              track_record_citations: ['hr7567-119'],
            },
          ],
        }),
      ),
    );

    const { synthesizeStances } = await import('@/lib/llm/curate');
    await expect(synthesizeStances(candidate)).rejects.toThrow(
      /Refusing fabricated citation/,
    );
  });

  it('auto-repairs a citation Haiku mentioned inline in the note but forgot to list explicitly', async () => {
    messagesCreateMock.mockResolvedValue(
      haikuTextResponse(
        JSON.stringify({
          top_stances: [
            {
              ...validStance,
              track_record_note: 'Voted YES on passage (house-119-2-411).',
              // track_record_citations omitted entirely
            },
          ],
        }),
      ),
    );

    const { synthesizeStances } = await import('@/lib/llm/curate');
    const result = await synthesizeStances(candidate);
    expect(result.top_stances[0].track_record_citations).toEqual(['house-119-2-411']);
  });

  it('silently drops an inline-only mention that does not match a real bill_id (not a fabrication error)', async () => {
    messagesCreateMock.mockResolvedValue(
      haikuTextResponse(
        JSON.stringify({
          top_stances: [
            {
              ...validStance,
              track_record_note: 'Broadly consistent with prior positions on H.R. 1234.',
              // no explicit citations array — inline "H.R. 1234" won't match
              // the canonical "hr1234-<congress>" form, so it should be
              // dropped, not treated as a fabrication.
            },
          ],
        }),
      ),
    );

    const { synthesizeStances } = await import('@/lib/llm/curate');
    const result = await synthesizeStances(candidate);
    expect(result.top_stances[0].track_record_citations).toBeUndefined();
  });
});

describe('synthesizeStances — JSON extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it('extracts JSON wrapped in a ```json fenced code block', async () => {
    const payload = JSON.stringify({ top_stances: [validStance] });
    messagesCreateMock.mockResolvedValue(
      haikuTextResponse('```json\n' + payload + '\n```'),
    );

    const { synthesizeStances } = await import('@/lib/llm/curate');
    const result = await synthesizeStances(candidate);
    expect(result.top_stances).toHaveLength(1);
  });

  it('extracts JSON from uneven output with preamble/trailing prose', async () => {
    const payload = JSON.stringify({ top_stances: [validStance] });
    messagesCreateMock.mockResolvedValue(
      haikuTextResponse(`Here is the analysis:\n${payload}\nLet me know if you need more.`),
    );

    const { synthesizeStances } = await import('@/lib/llm/curate');
    const result = await synthesizeStances(candidate);
    expect(result.top_stances).toHaveLength(1);
  });

  it('throws when there is no JSON object in the response at all', async () => {
    messagesCreateMock.mockResolvedValue(
      haikuTextResponse('I could not determine a stance for this candidate.'),
    );

    const { synthesizeStances } = await import('@/lib/llm/curate');
    await expect(synthesizeStances(candidate)).rejects.toThrow(
      /No JSON object in response/,
    );
  });

  it('throws on malformed JSON rather than silently passing', async () => {
    messagesCreateMock.mockResolvedValue(
      haikuTextResponse('{ top_stances: [this is not valid JSON] }'),
    );

    const { synthesizeStances } = await import('@/lib/llm/curate');
    await expect(synthesizeStances(candidate)).rejects.toThrow();
  });

  it('throws a Zod error when the parsed JSON does not match the schema', async () => {
    messagesCreateMock.mockResolvedValue(
      haikuTextResponse(JSON.stringify({ top_stances: [{ issue_slug: 'economy' }] })), // missing required fields
    );

    const { synthesizeStances } = await import('@/lib/llm/curate');
    await expect(synthesizeStances(candidate)).rejects.toThrow();
  });
});

describe('synthesizeStances — API key guard', () => {
  it('throws if ANTHROPIC_API_KEY is not set', async () => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;

    const { synthesizeStances } = await import('@/lib/llm/curate');
    await expect(synthesizeStances(candidate)).rejects.toThrow(
      /ANTHROPIC_API_KEY is required/,
    );
    expect(messagesCreateMock).not.toHaveBeenCalled();
  });
});
