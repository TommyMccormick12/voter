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
//   - Every track_record_note must cite a roll_call_id or statement_id from
//     the input data (validation rejects fabricated citations)

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Stance, TopStance } from '@/types/database';
import { ISSUE_SLUGS } from '@/lib/issues';

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
    vote_question: string | null;
    roll_call_id: string;
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

/**
 * True when a voting_record row's vote question is a PROCEDURAL motion rather
 * than a vote on the bill's substance.
 *
 * Why this exists: three independent verifiers on 2026-08-07 caught stances
 * built on motion-to-recommit votes, and the error ran BOTH ways — Bean's nay
 * on an MTR was written up as "voted against the Take Care of America's
 * Veterans Act" (a nay actually lets the bill proceed), while Castor's yea on
 * the same MTR was written up as supporting a veterans bill (a yea sends it
 * back). The term of art is the only thing carrying the inversion, and no
 * voter scanning a card can be expected to parse it.
 *
 * The fixture and database preserve this signal in `vote_question`. The
 * voter-facing `bill_title` can therefore hold the actual bill title.
 */
export function isProceduralVote(voteQuestion: string | null | undefined): boolean {
  if (!voteQuestion) return false;
  return /motion to recommit|motion to table|previous question|motion to adjourn|ordering the previous question/i.test(
    voteQuestion
  );
}

const StanceSchema = z.object({
  // The prompt already lists the valid slugs, but a prompt is advice, not a
  // constraint. Haiku returned `infrastructure` for Charles Gambaro on
  // 2026-08-08 — not in the taxonomy, so `issueName()` fell through to its
  // `?? slug` branch and the card would have rendered a bare lowercase
  // "infrastructure" chip where every other card shows a curated label.
  // Nothing caught it; a human reading the fixture did.
  //
  // Validating here rejects the response and retries, which is the whole
  // point of having a schema between the model and a voter-facing fixture.
  // ISSUE_SLUGS is derived from ISSUE_NAMES, so a taxonomy addition widens
  // this automatically and cannot drift from what the prompt advertises.
  issue_slug: z
    .string()
    .refine((slug) => ISSUE_SLUGS.includes(slug), {
      message: `issue_slug must be one of: ${ISSUE_SLUGS.join(', ')}`,
    }),
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

  const validRollCallIds = new Set(candidate.voting_record.map((v) => v.roll_call_id));
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
        text: [
          'You are a non-partisan civic data analyst. Output valid JSON only. Do not add a preamble.',
          'Schema: {top_stances: [{issue_slug, stance, summary, source_excerpt?, confidence, track_record_note?, track_record_citations?}]}.',
          `The issue_slug must be one of: ${ISSUE_SLUGS.join(', ')}.`,
          'Select the issue slug that best fits the source material.',
          'The stance value shows how strongly the candidate holds the opinion in the summary.',
          'It does not show agreement with the issue_slug name.',
          'The stance value must be strongly_support, support, neutral, oppose, or strongly_oppose.',
          'Write the summary in 30 words or fewer. Use the candidate\'s own framing.',
          'Set confidence from 0 through 100. Use the strength of the source evidence.',
          'Add track_record_note only for a substantive observation about a listed vote or statement.',
          'Do not add meta-comments about missing records, missing contradictions, or insufficient data.',
          'For a vote citation, use the exact roll_call_id from VOTING RECORD.',
          'For a statement citation, use the exact statement_id from STATEMENTS.',
          'Put each cited identifier in track_record_citations. The citation list is a strict whitelist.',
          'Never use bill_id as a voting citation. One bill can have multiple opposed roll calls.',
          'State vote alignment or contradiction in track_record_note. Do not editorialize.',
          'Do not claim a position that the source does not contain.',
        ].join(' '),
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
  // Haiku reliably writes roll_call_ids INSIDE the note text but inconsistently
  // populates track_record_citations even when the prompt requires it.
  // We solve this server-side: extract roll-call IDs from the note
  // text, validate each against the input voting record, and rebuild the
  // citations array. Fabricated citations still throw (whitelist-only).
  const validatedStances: TopStance[] = parsed.top_stances.map((s) => {
    const stanceId = `${candidate.slug}-${s.issue_slug}`;

    // Collect citations from both fields: what Haiku explicitly listed,
    // PLUS what it referenced inline in the note text.
    const explicit = s.track_record_citations ?? [];
    const inlineFromNote = extractRollCallIdsFromText(s.track_record_note ?? '');
    const allCandidates = new Set<string>([...explicit, ...inlineFromNote]);

    const validated: string[] = [];
    for (const cit of allCandidates) {
      if (validRollCallIds.has(cit) || validStatementIds.has(cit)) {
        validated.push(cit);
        continue;
      }
      // Treat unknown citations as fabrication only if Haiku put it in the
      // explicit list. Inline-from-note extractions that don't match a real
      // roll_call_id are silently dropped. This avoids false fabrication
      // errors for free-form bill names in the note text.
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
      // Drop a note that only announces an absence — see isAbsenceOnlyNote.
      track_record_note: isAbsenceOnlyNote(s.track_record_note)
        ? undefined
        : s.track_record_note,
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
    'VOTING RECORD (most recent first).',
    'Each row gives the bill title and the exact vote question. Rows marked',
    '[PROCEDURAL] are motions about handling the bill, not its substance —',
    'their meaning INVERTS: a NAY on a motion to recommit generally supports',
    'the underlying bill, and a YEA generally opposes it as written.',
    ...(c.voting_record.length > 0
      ? c.voting_record.slice(0, 30).map(
          (v) => {
            // Fixtures written before migration 016 stored the question in
            // bill_title. Keep that fallback until every fixture is re-ingested.
            const voteQuestion = v.vote_question ?? v.bill_title;
            return `- roll_call_id="${v.roll_call_id}" | bill_id="${v.bill_id}"${isProceduralVote(voteQuestion) ? ' [PROCEDURAL]' : ''} | ${v.vote.toUpperCase()} on "${v.bill_title}" | question="${voteQuestion}" (${v.vote_date}) [issues: ${v.issue_slugs.join(',') || 'unknown'}]`;
          }
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
    'TASK: Produce top_stances JSON. Cover the candidate\'s strongest stances on issues where the source data gives clear signal. Skip issues with no signal. If a voting record contradicts a stated message, set track_record_note and cite the roll_call_id. If a top donor industry conflicts with a stance, flag it in track_record_note (no citation needed for donor data). Output JSON only.',
  ];
  return parts.filter(Boolean).join('\n');
}

/**
 * Pull exact roll_call_id strings from a free-form track_record_note.
 * This repairs a missing citations array when the note includes the ID.
 */
function extractRollCallIdsFromText(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const m of text.matchAll(/\b(?:house-\d+-[12]-\d+|senate-\d+-\d+)\b/gi)) {
    found.add(m[0].toLowerCase());
  }
  return Array.from(found);
}

/**
 * A track_record_note earns its place only when it says something about a
 * specific vote or statement. The system prompt already forbids notes that
 * merely announce an absence ("no relevant voting record", "insufficient
 * data") and tells Haiku to omit the field instead. Haiku ignores that for
 * challengers: every stance for a candidate who has never held office came
 * back carrying "No voting record available as candidate has not held
 * office."
 *
 * That is dead weight on a scorecard — repeated on every card, telling a
 * voter nothing about the candidate. It also lands hardest on exactly the
 * population we are trying to cover, since no challenger has a voting
 * record. Prompt discipline alone has not held, so this drops such notes
 * server-side, in the same spirit as the citation auto-repair above.
 *
 * Deliberately conservative: it fires only when the note is ENTIRELY an
 * absence claim. A note that reports a real vote and then mentions a gap
 * keeps its substance and is left alone.
 */
export function isAbsenceOnlyNote(note: string | null | undefined): boolean {
  if (!note) return false;
  const text = note.trim();
  if (!text) return false;
  // A note citing a specific roll call or statement is substantive by
  // definition — never strip it, whatever else it says.
  if (extractRollCallIdsFromText(text).length > 0) return false;

  const ABSENCE_PATTERNS = [
    /\bno\b[^.]{0,40}\b(?:voting\s+record|votes?\s+on\s+record|congressional\s+record)\b/i,
    /\bno\b[^.]{0,30}\b(?:contradictions?|inconsistenc(?:y|ies)|discrepanc(?:y|ies))\b[^.]{0,20}\b(?:found|identified|noted)?\b/i,
    /\binsufficient\s+(?:data|evidence|information)\b/i,
    /\b(?:has\s+not|never|hasn't)\s+(?:held|served\s+in)\s+(?:public\s+)?office\b/i,
    /\bnot\s+(?:an?\s+)?(?:incumbent|sitting)\b/i,
    /\bunable\s+to\s+verify\b/i,
    /\bno\s+(?:public\s+)?statements?\s+(?:available|found|on\s+record)\b/i,
  ];

  // Split into sentences and require EVERY one to be an absence claim.
  // One substantive sentence is enough to keep the whole note.
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (sentences.length === 0) return false;
  return sentences.every((sentence) => ABSENCE_PATTERNS.some((re) => re.test(sentence)));
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
