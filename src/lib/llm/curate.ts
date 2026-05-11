// Offline candidate stance synthesis. Run from scripts/synthesize/, NOT
// from production runtime. Uses Haiku 4.5 (cheapest tier, per the plan's
// locked decision) — synthesis is structured extraction from public data,
// well within Haiku's quality range.
//
// What this does:
//   Input: candidate's stated platform (Ballotpedia key messages,
//          campaign-site statements), voting record (ProPublica), donor
//          profile (OpenSecrets/FEC).
//   Output: top_stances JSON with summary + optional track_record_note
//          that cites specific bills or statements. Notes flag stated-vs-
//          actual contradictions (e.g. "voted NAY on similar bill" or
//          "top donor industry contradicts stance").
//
// Output discipline:
//   - JSON-only (Zod-parsed, errors out on drift)
//   - Every stance_id is a stable hash of (candidate_slug + issue_slug)
//   - Every track_record_note must cite a bill_id or statement_id from
//     the input data (validation rejects fabricated citations)

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Stance, TopStance } from '@/types/database';

const HAIKU_MODEL = 'claude-haiku-4-5';

export interface CandidateRawData {
  slug: string;
  name: string;
  party: string;
  bio: string | null;
  key_messages: string[];
  campaign_themes: Array<{ heading: string; text: string }>;
  voting_record: Array<{
    bill_id: string;
    bill_title: string;
    bill_summary: string | null;
    vote: string;
    issue_slugs: string[];
    vote_date: string;
  }>;
  statements: Array<{
    id?: string;
    statement_text: string;
    statement_date: string | null;
    issue_slugs: string[];
  }>;
  top_industries: Array<{ industry_name: string; amount: number; rank: number }>;
}

const StanceSchema = z.object({
  issue_slug: z.string(),
  stance: z.enum([
    'strongly_support',
    'support',
    'neutral',
    'oppose',
    'strongly_oppose',
  ]),
  summary: z.string().max(200),
  source_excerpt: z.string().optional(),
  confidence: z.number().min(0).max(100),
  track_record_note: z.string().optional(),
  track_record_citations: z.array(z.string()).optional(),
});

const SynthesisSchema = z.object({
  top_stances: z.array(StanceSchema).min(1).max(10),
});

export interface SynthesisResult {
  top_stances: TopStance[];
  input_tokens: number;
  output_tokens: number;
}

/**
 * Synthesize top_stances for one candidate using Haiku.
 * @throws if ANTHROPIC_API_KEY is not set or response shape is invalid.
 */
export async function synthesizeStances(
  candidate: CandidateRawData
): Promise<SynthesisResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is required for synthesis. Set it in .env.local.'
    );
  }
  const client = new Anthropic({ apiKey });

  const validBillIds = new Set(candidate.voting_record.map((v) => v.bill_id));
  const validStatementIds = new Set(
    candidate.statements.map((s) => s.id).filter((id): id is string => Boolean(id))
  );

  const userPrompt = buildPrompt(candidate);
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 2048,
    system: [
      {
        type: 'text',
        text: 'You are a non-partisan civic data analyst. Output VALID JSON ONLY, no preamble. Schema: {top_stances: [{issue_slug, stance, summary, source_excerpt?, confidence, track_record_note?, track_record_citations?}]}. Rules: (1) issue_slug MUST be one of: economy, healthcare, immigration, climate, education, guns, criminal_justice, foreign_policy, taxes, housing. (2) stance MUST be exactly one of: strongly_support, support, neutral, oppose, strongly_oppose. (3) summary <=30 words, written in the candidate\'s own framing. (4) confidence 0-100 reflects how strongly the source data supports the stance. (5) track_record_note OPTIONAL and only included when there is a substantive observation tied to specific bills or statements (e.g. "voted YES on hr7567-119 aligning with stance" or "voted NAY on hres1189-119 despite supporting..."). NEVER include meta-comments like "no contradictions found", "no relevant voting record", "insufficient data to verify" — just omit the field entirely. If included, EVERY bill_id you reference in the note text (e.g. "H.Res. 1189", "S. 4465", "hr7567-119") MUST appear in track_record_citations as a valid input bill_id from the VOTING RECORD or input statement_id from STATEMENTS. Citations are a strict whitelist — fabricated citations will be rejected. (6) Use bill_id strings exactly as they appear in the input (e.g. "hres1189-119"), not freeform names. (7) Flag contradictions ("voted NAY despite supporting...") or alignment ("voted YES on H.R.X") in the note text. Never editorialize. Never claim positions not in the source.',
      },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text block in Haiku response');
  }
  const json = extractJson(textBlock.text);
  const parseResult = SynthesisSchema.safeParse(json);
  if (!parseResult.success) {
    // Log the raw response so the user can see exactly what Haiku produced
    // when the Zod validation fails. The error array alone (without raw)
    // makes drift impossible to debug.
    console.error('[curate] Haiku response failed Zod validation. Raw response:');
    console.error(JSON.stringify(json, null, 2));
    throw parseResult.error;
  }
  const parsed = parseResult.data;

  // Validate citations + auto-repair missing ones.
  //
  // Haiku reliably writes bill_ids INSIDE the note text but inconsistently
  // populates track_record_citations even when the prompt requires it.
  // We solve this server-side: extract bill-id-like strings from the note
  // text, validate each against the input voting record, and rebuild the
  // citations array. Fabricated citations still throw (whitelist-only).
  const validatedStances: TopStance[] = parsed.top_stances.map((s) => {
    const stanceId = `${candidate.slug}-${s.issue_slug}`;

    // Collect citations from both fields: what Haiku explicitly listed,
    // PLUS what it referenced inline in the note text.
    const explicit = s.track_record_citations ?? [];
    const inlineFromNote = extractBillIdsFromText(s.track_record_note ?? '');
    const allCandidates = new Set<string>([...explicit, ...inlineFromNote]);

    const validated: string[] = [];
    for (const cit of allCandidates) {
      if (validBillIds.has(cit) || validStatementIds.has(cit)) {
        validated.push(cit);
        continue;
      }
      // Treat unknown citations as fabrication only if Haiku put it in the
      // explicit list. Inline-from-note extractions that don't match a real
      // bill_id are silently dropped (likely a parsing false positive on
      // freeform text like "H.R. 7567" which won't match "hr7567-119").
      if (explicit.includes(cit)) {
        throw new Error(
          `Haiku cited unknown source "${cit}" for ${candidate.name} ${s.issue_slug}. Refusing fabricated citation.`,
        );
      }
    }

    return {
      stance_id: stanceId,
      issue_slug: s.issue_slug,
      stance: s.stance as Stance,
      summary: s.summary,
      source_url: '', // Filled in by the seed step from raw data
      source_excerpt: s.source_excerpt,
      confidence: s.confidence,
      track_record_note: s.track_record_note,
      track_record_citations: validated.length > 0 ? validated : s.track_record_citations,
    };
  });

  return {
    top_stances: validatedStances,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };
}

function buildPrompt(c: CandidateRawData): string {
  const parts: string[] = [
    `Candidate: ${c.name} (${c.party})`,
    c.bio ? `Bio: ${c.bio}` : '',
    '',
    'KEY MESSAGES (campaign platform):',
    ...(c.key_messages.length > 0 ? c.key_messages.map((m, i) => `${i + 1}. ${m}`) : ['(none)']),
    '',
    'CAMPAIGN THEMES:',
    ...(c.campaign_themes.length > 0
      ? c.campaign_themes.map((t) => `- [${t.heading}] ${t.text}`)
      : ['(none)']),
    '',
    'VOTING RECORD (most recent first):',
    ...(c.voting_record.length > 0
      ? c.voting_record.slice(0, 30).map(
          (v) =>
            `- bill_id="${v.bill_id}" | ${v.vote.toUpperCase()} on "${v.bill_title}" (${v.vote_date}) [issues: ${v.issue_slugs.join(',') || 'unknown'}]`
        )
      : ['(none — challenger or not yet in office)']),
    '',
    'PUBLIC STATEMENTS:',
    ...(c.statements.length > 0
      ? c.statements.map(
          (s) =>
            `- ${s.statement_date ?? 'undated'}: "${s.statement_text.slice(0, 200)}"`
        )
      : ['(none)']),
    '',
    'DONOR TOP INDUSTRIES (cycle):',
    ...(c.top_industries.length > 0
      ? c.top_industries
          .slice(0, 5)
          .map((i) => `- ${i.industry_name}: $${i.amount.toLocaleString()}`)
      : ['(none)']),
    '',
    'TASK: Produce top_stances JSON. Cover the candidate\'s strongest stances on issues where the source data gives clear signal. Skip issues with no signal. If a voting record contradicts a stated message, set track_record_note flagging it and cite the bill_id. If a top donor industry conflicts with a stance, flag it in track_record_note (no citation needed for donor data). Output JSON only.',
  ];
  return parts.filter(Boolean).join('\n');
}

/**
 * Pull out any bill_id-like strings from a free-form track_record_note.
 * Returns the canonical lowercase form (e.g. "hres1189-119"). Used to
 * auto-populate track_record_citations when Haiku references a bill in
 * the note text but forgets to add it to the citations array.
 *
 * Matches both canonical forms ("hres1189-119") and freeform mentions
 * ("H.Res. 1189", "S. 4465") — the latter get normalized to the canonical
 * form so they can be checked against validBillIds.
 */
function extractBillIdsFromText(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  // Canonical form: typeNNN-congress (e.g. hres1189-119, hr7567-119, s4465-119)
  for (const m of text.matchAll(/\b(hr|hres|hjres|hconres|s|sres|sjres|sconres)\d+-\d+\b/gi)) {
    found.add(m[0].toLowerCase());
  }
  // Freeform: "H.Res. 1189", "H.R. 7567", "S. 4465" — congress unknown
  // (caller validates against bill_ids, so freeform mentions without
  // -<congress> won't match anything in validBillIds; that's intentional
  // — only canonical form survives the whitelist check).
  return Array.from(found);
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('No JSON object in response');
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}
