// Data boundary — T14 (Spec C1).
//
// The ONE place raw Supabase rows get converted into application
// types. src/lib/data/races.ts and src/lib/data/candidates.ts call
// into this module instead of casting query results themselves; no
// other module should reach past src/lib/data/* to touch a raw row.
//
// Naming-convention note: this app's application types (src/types/
// database.ts — Race, Candidate, CandidatePosition, ...) already use
// the DB's snake_case field names as their own convention; there is no
// existing camelCase layer anywhere in the app (21 consumer files key
// off `race_id`, `top_stances`, `photo_url`, etc. directly). Renaming
// the field convention here would ripple into every page and
// component that reads these types — out of scope for T14, which owns
// src/lib/data/**, src/lib/supabase.ts, and src/types/** only, and is
// told to keep races.ts/candidates.ts signatures compatible so T16 can
// do the typed-result pass. What this module *does* do is what the
// constraint is actually protecting against: no unvalidated,
// arbitrarily-shaped row escapes src/lib/data/. Every field is
// explicitly read, coerced, and defaulted here — not passed through
// with a bare `as` cast.

import type {
  Race,
  Candidate,
  CandidatePosition,
  CandidateDonor,
  CandidateTopIndustry,
  CandidateVote,
  CandidateStatement,
  TopStance,
  Stance,
  ElectionType,
  DataSource,
  DonorType,
} from '@/types/database';

// Every converter below reads a raw, defensively-typed PostgREST row
// (`Record<string, unknown>`) rather than assuming a precise generated
// Row type. Two reasons:
//   1. races.ts/candidates.ts select partial column lists (not
//      `select('*')`), so the exact TS shape supabase-js infers for a
//      given select-string depends on postgrest-js's template-literal
//      parsing, which is brittle to depend on across partial selects
//      and embedded joins together.
//   2. getCandidateBySlug's embedded child selects (candidate_positions,
//      candidate_donors, ...) need Relationships metadata in the
//      Database type (src/types/supabase.ts) for full type inference,
//      which this hand-derived generated-types file does not model
//      (out of scope for T14).
// The typed Database interface still does real work at the call site:
// `.from()`, `.eq()`, `.select()` column names, and `.insert()`/
// `.update()` payloads are all validated against the schema. This
// module is the second half of the boundary — turning whatever comes
// back into a known-good, fully-typed application object instead of
// letting a raw/partial row escape src/lib/data/.

// Typed result wrapper for src/lib/data/* reads — T16 (Spec C3).
//
// races.ts and candidates.ts return one of these from every exported
// read instead of swallowing a Supabase error into `null` / `[]`.
// `ok: true` with an empty array or a `null` item is a legitimate
// empty result (no active candidates yet, race not found). `ok: false`
// means the read itself failed — env misconfiguration or a DB error —
// and the caller must render an honest error state, not an empty one.
// This is the distinction the "swallowed errors" bug class erased.

export type DataErrorKind = 'config_error' | 'db_error';

export interface DataError {
  kind: DataErrorKind;
  message: string;
}

export type DataResult<T> = { ok: true; data: T } | { ok: false; error: DataError };

export function dataOk<T>(data: T): DataResult<T> {
  return { ok: true, data };
}

export function dataErr<T>(error: DataError): DataResult<T> {
  return { ok: false, error };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function toRace(row: Record<string, unknown>): Race {
  return {
    id: str(row.id),
    state: str(row.state),
    district: strOrNull(row.district),
    office: str(row.office),
    election_date: str(row.election_date),
    cycle: num(row.cycle),
    election_type: str(row.election_type) as ElectionType,
    primary_party: strOrNull(row.primary_party),
    // Migration 013 and seed_races.ts provide the no-primary state.
    no_primary: Boolean(row.no_primary),
    no_primary_note: strOrNull(row.no_primary_note),
    // Migration 017. numOrNull keeps an absent column as null rather than
    // 0 — a 0 here would tell a voter the ballot is empty.
    ballot_candidate_count: numOrNull(row.ballot_candidate_count),
  };
}

/** Guards against JSONB drift: top_stances must be an array of objects. */
function normalizeTopStances(raw: unknown): TopStance[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is TopStance =>
      typeof s === 'object' && s !== null && 'issue_slug' in s && 'stance' in s
  );
}

export function toCandidate(row: Record<string, unknown>): Candidate {
  return {
    id: str(row.id),
    name: str(row.name),
    slug: str(row.slug),
    party: strOrNull(row.party),
    state: str(row.state),
    district: strOrNull(row.district),
    race_id: strOrNull(row.race_id),
    office: str(row.office),
    photo_url: strOrNull(row.photo_url),
    bio: strOrNull(row.bio),
    website: strOrNull(row.website),
    active: Boolean(row.active),
    primary_party: strOrNull(row.primary_party),
    incumbent: Boolean(row.incumbent),
    total_raised: numOrNull(row.total_raised),
    // Backed by candidates.fec_coverage_end_date (migration 014) and
    // selected via CANDIDATE_BASE_COLUMNS; NULL means unknown (see the
    // field's doc comment in src/types/database.ts).
    fec_coverage_end_date: strOrNull(row.fec_coverage_end_date),
    top_stances: normalizeTopStances(row.top_stances),
  };
}

export function toCandidatePosition(row: Record<string, unknown>): CandidatePosition {
  return {
    id: str(row.id),
    candidate_id: str(row.candidate_id),
    issue_id: str(row.issue_id),
    stance: str(row.stance) as Stance,
    summary: str(row.summary),
    source_url: strOrNull(row.source_url),
    confidence: num(row.confidence, 70),
    source_type: strOrNull(row.source_type) as DataSource | null,
    source_excerpt: strOrNull(row.source_excerpt),
    sourced_at: strOrNull(row.sourced_at),
  };
}

export function toCandidateDonor(row: Record<string, unknown>): CandidateDonor {
  return {
    id: str(row.id),
    candidate_id: str(row.candidate_id),
    donor_name: str(row.donor_name),
    donor_type: strOrNull(row.donor_type) as DonorType | null,
    industry: strOrNull(row.industry),
    amount_total: num(row.amount_total),
    cycle: num(row.cycle),
    fec_committee_id: strOrNull(row.fec_committee_id),
    data_source: str(row.data_source) as DataSource,
    rank_in_candidate: numOrNull(row.rank_in_candidate),
    fetched_at: str(row.fetched_at),
  };
}

export function toCandidateTopIndustry(row: Record<string, unknown>): CandidateTopIndustry {
  return {
    id: str(row.id),
    candidate_id: str(row.candidate_id),
    industry_name: str(row.industry_name),
    industry_code: strOrNull(row.industry_code),
    amount: num(row.amount),
    rank: num(row.rank),
    cycle: num(row.cycle),
    data_source: str(row.data_source) as DataSource,
  };
}

export function toCandidateVote(row: Record<string, unknown>): CandidateVote {
  const significance = strOrNull(row.significance);
  return {
    id: str(row.id),
    candidate_id: str(row.candidate_id),
    bill_id: str(row.bill_id),
    bill_title: str(row.bill_title),
    vote_question: strOrNull(row.vote_question),
    roll_call_id: strOrNull(row.roll_call_id),
    bill_summary: strOrNull(row.bill_summary),
    vote: str(row.vote) as CandidateVote['vote'],
    issue_slugs: strArray(row.issue_slugs),
    vote_date: str(row.vote_date),
    source: strOrNull(row.source) as DataSource | null,
    source_url: strOrNull(row.source_url),
    significance:
      significance === 'major' || significance === 'routine' || significance === 'procedural'
        ? significance
        : null,
  };
}

export function toCandidateStatement(row: Record<string, unknown>): CandidateStatement {
  return {
    id: str(row.id),
    candidate_id: str(row.candidate_id),
    statement_text: str(row.statement_text),
    statement_date: strOrNull(row.statement_date),
    context: strOrNull(row.context) as CandidateStatement['context'],
    issue_slugs: strArray(row.issue_slugs),
    source_url: strOrNull(row.source_url),
    source_quality: num(row.source_quality, 70),
  };
}
