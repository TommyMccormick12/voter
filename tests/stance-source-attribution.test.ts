// A stance must cite the page its claim actually appears on.
//
// synthesize_stances.ts used to stamp EVERY stance with a single candidate
// `website` value. That is right while a candidate is authored from one page
// and silently wrong the moment one is authored from two. Troy Albers was
// authored from his campaign issues page AND his voter-guide answers; all
// seven stances got the campaign site, so the three claims that live only in
// the guide — the Neighborhood Homes Investment Act, opposing data centres,
// and doing more on climate change — cited a page that does not contain them.
// A voter clicking through found nothing. It was caught by a human re-reading
// the sources, not by anything in the pipeline.
//
// Themes may now declare a source, and the model picks among them. This file
// pins the whitelist half of that: a stance may cite a page the input
// offered, and never one it invented.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CandidateRawData } from '@/lib/llm/curate';

const ISSUES = 'https://albersforcongress.com/issues';
const GUIDE = 'https://www.clickorlando.com/voters-guide/2026/07/31/x/';

const createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: (...a: unknown[]) => createMock(...a) };
  },
}));

function reply(stances: Array<Record<string, unknown>>) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ top_stances: stances }) }],
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

const stance = (over: Record<string, unknown> = {}) => ({
  issue_slug: 'housing',
  stance: 'support',
  summary: 'Supports the Neighborhood Homes Investment Act.',
  confidence: 90,
  ...over,
});

function candidate(themes: CandidateRawData['campaign_themes']): CandidateRawData {
  return {
    slug: 'troy-albers',
    name: 'Troy Albers',
    party: 'D',
    bio: null,
    key_messages: [],
    campaign_themes: themes,
    voting_record: [],
    statements: [],
    top_industries: [],
  };
}

describe('per-stance source attribution', () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  async function synth(themes: CandidateRawData['campaign_themes']) {
    const { synthesizeStances } = await import('@/lib/llm/curate');
    return synthesizeStances(candidate(themes));
  }

  it('keeps the source the model chose from the declared themes', async () => {
    // The regression: this claim lives in the guide, not the issues page.
    createMock.mockResolvedValue(reply([stance({ source_url: GUIDE })]));
    const r = await synth([
      { heading: 'Insurance', text: 'a', source_url: ISSUES },
      { heading: 'Housing', text: 'b', source_url: GUIDE },
    ]);
    expect(r.top_stances[0].source_url).toBe(GUIDE);
  });

  it('lets each stance cite a different declared page', async () => {
    createMock.mockResolvedValue(
      reply([
        stance({ issue_slug: 'housing', source_url: GUIDE }),
        stance({ issue_slug: 'healthcare', source_url: ISSUES }),
      ]),
    );
    const r = await synth([
      { heading: 'Insurance', text: 'a', source_url: ISSUES },
      { heading: 'Housing', text: 'b', source_url: GUIDE },
    ]);
    expect(r.top_stances.map((s) => s.source_url)).toEqual([GUIDE, ISSUES]);
  });

  it('refuses a source the input never offered', async () => {
    // Same rule as the roll-call whitelist: choose among what you were given,
    // never invent. An invented link is worse than none — it looks checkable.
    createMock.mockResolvedValue(
      reply([stance({ source_url: 'https://not-a-source.example/issues' })]),
    );
    await expect(synth([{ heading: 'Housing', text: 'b', source_url: GUIDE }])).rejects.toThrow(
      /unknown source/i,
    );
  });

  it('names the declared sources in the refusal, so the miss is diagnosable', async () => {
    createMock.mockResolvedValue(reply([stance({ source_url: 'https://wrong.example' })]));
    await expect(synth([{ heading: 'Housing', text: 'b', source_url: GUIDE }])).rejects.toThrow(
      new RegExp(GUIDE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  });

  it('falls through to empty when the model names no source, so the website fallback still applies', async () => {
    // The single-source candidate is the common case and must not regress:
    // synthesize_stances.ts fills the blank from the candidate website.
    createMock.mockResolvedValue(reply([stance()]));
    const r = await synth([{ heading: 'Housing', text: 'b' }]);
    expect(r.top_stances[0].source_url).toBe('');
  });

  it('ignores a whitespace-only source rather than storing a blank link', async () => {
    createMock.mockResolvedValue(reply([stance({ source_url: '   ' })]));
    const r = await synth([{ heading: 'Housing', text: 'b', source_url: GUIDE }]);
    expect(r.top_stances[0].source_url).toBe('');
  });

  it('trims a padded source before matching, so formatting is not a refusal', async () => {
    createMock.mockResolvedValue(reply([stance({ source_url: `  ${GUIDE}  ` })]));
    const r = await synth([{ heading: 'Housing', text: 'b', source_url: GUIDE }]);
    expect(r.top_stances[0].source_url).toBe(GUIDE);
  });

  it('offers each declared source to the model in the prompt', async () => {
    createMock.mockResolvedValue(reply([stance()]));
    await synth([
      { heading: 'Insurance', text: 'a', source_url: ISSUES },
      { heading: 'Housing', text: 'b', source_url: GUIDE },
    ]);
    const prompt = createMock.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain(ISSUES);
    expect(prompt).toContain(GUIDE);
  });

  it('stays silent about source_url when no theme declares one', async () => {
    // Most candidates are single-source. Do not spend prompt on a rule that
    // cannot apply, and do not invite the model to guess a URL.
    createMock.mockResolvedValue(reply([stance()]));
    await synth([{ heading: 'Housing', text: 'b' }]);
    const system = createMock.mock.calls[0][0].system[0].text as string;
    expect(system).not.toMatch(/Set source_url to the URL/i);
  });
});
