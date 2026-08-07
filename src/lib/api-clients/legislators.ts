// unitedstates/congress-legislators ID crosswalk.
//
// Why this exists (T10 / spec B1.3 + B2, Decision 6):
//   Congress.gov and Voteview both key votes by bioguide ID. Our fixtures
//   key candidates by FEC candidate_id (assigned upstream by the DOE/FEC
//   entity spine — see fetch_fec.ts). This module is the ONLY place that
//   bridges the two, and it does so by ID lookup alone — no candidate name
//   is ever read or compared here. That is the fix for the
//   DATA-AUDIT-2026-08-06 finding: `matchRoleByName` (govtrack.ts, now
//   deleted) let "Royal Webster" inherit incumbent Daniel Webster's
//   govtrack_id and voting record because it fell back to last-name-only
//   matching. An ID crosswalk cannot make that mistake — either a
//   candidate's fec_candidate_id appears in a legislator's id.fec list, or
//   it does not.
//
// Source: https://github.com/unitedstates/congress-legislators
//   (raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml)
//   Actively maintained; last commit July 2026 per DATA-SOURCES-2026-08-06.md.
//
// Why a hand-rolled YAML reader instead of a library: the repo ships no
// YAML-parsing dependency (js-yaml is present only as a transitive
// dependency of other tooling, unlisted in package.json — installing a new
// direct dependency is out of scope for this ticket). legislators-current.yaml
// is entirely block-style YAML (mapping/sequence nesting + scalars; no flow
// collections, anchors, tags, or multi-line block scalars — verified against
// the live file 2026-08-06). parseYaml() below implements exactly that
// subset. It is not a general-purpose YAML parser and will misparse
// documents that use features outside that subset.

import { fetchCachedText, requireEnv, fetchCached } from './base';

const LEGISLATORS_CURRENT_URL =
  'https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml';

// ============================================================
// Types — the slice of congress-legislators we read
// ============================================================

export interface LegislatorId {
  bioguide: string;
  fec?: string[];
  wikidata?: string;
  [key: string]: unknown;
}

export interface LegislatorTerm {
  type: 'rep' | 'sen';
  start: string;
  end: string;
  state: string;
  district?: number;
  class?: number;
  party?: string;
  [key: string]: unknown;
}

export interface LegislatorName {
  first: string;
  last: string;
  middle?: string;
  official_full?: string;
  [key: string]: unknown;
}

export interface Legislator {
  id: LegislatorId;
  name: LegislatorName;
  terms: LegislatorTerm[];
  [key: string]: unknown;
}

// ============================================================
// Minimal block-style YAML parser
// ============================================================

interface Line {
  indent: number;
  text: string; // content after the leading indent, trailing whitespace trimmed
}

function toLines(raw: string): Line[] {
  const out: Line[] = [];
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '') continue; // blank lines carry no structure here
    if (/^\s*#/.test(line)) continue; // full-line comment (none in practice, cheap to allow)
    const indent = line.length - line.trimStart().length;
    out.push({ indent, text: line.slice(indent).replace(/\s+$/, '') });
  }
  return out;
}

function isSeqMarker(text: string): boolean {
  return text === '-' || text.startsWith('- ');
}

function splitKeyValue(text: string): { key: string; rest: string } {
  const idx = text.indexOf(': ');
  if (idx !== -1) {
    return { key: text.slice(0, idx), rest: text.slice(idx + 2) };
  }
  if (text.endsWith(':')) {
    return { key: text.slice(0, -1), rest: '' };
  }
  // Defensive fallback — treat the whole line as a key with no value rather
  // than throwing, since a handful of edge-case lines (rare) shouldn't sink
  // the whole crosswalk fetch.
  return { key: text, rest: '' };
}

function parseScalar(raw: string): unknown {
  const s = raw.trim();
  if (s === '') return null;
  if (s === '~' || s.toLowerCase() === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return Number.parseFloat(s);
  return s;
}

class Cursor {
  pos = 0;
  constructor(private lines: Line[]) {}
  peek(): Line | null {
    return this.pos < this.lines.length ? this.lines[this.pos] : null;
  }
  next(): Line {
    return this.lines[this.pos++];
  }
}

function parseNodeAt(cur: Cursor, indent: number): unknown {
  const line = cur.peek();
  if (!line || line.indent < indent) return null;
  if (isSeqMarker(line.text)) return parseSeq(cur, line.indent);
  return parseMap(cur, line.indent);
}

function parseSeq(cur: Cursor, indent: number): unknown[] {
  const result: unknown[] = [];
  while (true) {
    const line = cur.peek();
    if (!line || line.indent !== indent || !isSeqMarker(line.text)) break;
    cur.next();
    const rest = line.text === '-' ? '' : line.text.slice(2);
    const itemIndent = indent + 2;
    if (rest === '') {
      result.push(parseNodeAt(cur, itemIndent));
      continue;
    }
    if (isSeqMarker(rest)) {
      // "- - x" (sequence of sequences) — not present in this file, but
      // handle it rather than silently mis-nesting.
      result.push(parseInlineSeqItem(cur, rest, itemIndent));
      continue;
    }
    const { key, rest: valueRest } = splitKeyValue(rest);
    const looksLikeMapKey = rest.includes(': ') || rest.endsWith(':');
    if (looksLikeMapKey) {
      result.push(parseMapFromFirstLine(cur, key, valueRest, itemIndent));
    } else {
      result.push(parseScalar(rest));
    }
  }
  return result;
}

function parseInlineSeqItem(cur: Cursor, rest: string, indent: number): unknown {
  // Re-inject the synthetic line so parseSeq sees it at the right indent.
  const synthetic: Line = { indent, text: rest };
  const patched = new Cursor([synthetic]);
  const value = parseSeq(patched, indent);
  return value;
}

function parseMap(cur: Cursor, indent: number): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  while (true) {
    const line = cur.peek();
    if (!line || line.indent !== indent || isSeqMarker(line.text)) break;
    cur.next();
    const { key, rest } = splitKeyValue(line.text);
    obj[key] = resolveValue(cur, rest, indent);
  }
  return obj;
}

/** Parses a mapping whose first key:value pair is already consumed (the
 * "- key: value" line of a sequence item) and whose remaining keys are
 * plain lines at `indent`. */
function parseMapFromFirstLine(
  cur: Cursor,
  firstKey: string,
  firstRest: string,
  indent: number,
): Record<string, unknown> {
  const obj: Record<string, unknown> = { [firstKey]: resolveValue(cur, firstRest, indent) };
  while (true) {
    const line = cur.peek();
    if (!line || line.indent !== indent || isSeqMarker(line.text)) break;
    cur.next();
    const { key, rest } = splitKeyValue(line.text);
    obj[key] = resolveValue(cur, rest, indent);
  }
  return obj;
}

function resolveValue(cur: Cursor, rest: string, parentIndent: number): unknown {
  if (rest !== '') return parseScalar(rest);
  const next = cur.peek();
  if (!next) return null;
  if (next.indent > parentIndent) return parseNodeAt(cur, next.indent);
  // YAML idiom used throughout this file: a block sequence value may be
  // indented the SAME as its parent key, not deeper —
  //   terms:
  //   - type: rep
  //     start: ...
  // Distinguish this from "the next line is actually a sibling key" by
  // requiring a sequence marker at the equal indent.
  if (next.indent === parentIndent && isSeqMarker(next.text)) {
    return parseSeq(cur, parentIndent);
  }
  return null;
}

/**
 * Parse the block-style YAML subset used by legislators-current.yaml (and
 * legislators-historical.yaml, same generator) into plain JS values.
 * Exported for direct unit testing — this is the highest-risk piece of the
 * crosswalk (hand-rolled parser, no library backstop).
 */
export function parseYaml(raw: string): unknown {
  const lines = toLines(raw);
  const cur = new Cursor(lines);
  const value = parseNodeAt(cur, 0);
  return value;
}

// ============================================================
// Fetch + cache
// ============================================================

let cachedLegislators: Legislator[] | null = null;

/**
 * Fetch + parse the current-Congress legislator roster. Cached on disk
 * (supabase/seed/raw/) via fetchCachedText and in-process for the run.
 */
export async function fetchLegislators(): Promise<Legislator[]> {
  if (cachedLegislators) return cachedLegislators;
  const text = await fetchCachedText(LEGISLATORS_CURRENT_URL, {
    cacheTag: 'congress-legislators:legislators-current',
  });
  const parsed = parseYaml(text);
  if (!Array.isArray(parsed)) {
    throw new Error(
      'legislators-current.yaml did not parse to a top-level list — parser or source format changed',
    );
  }
  cachedLegislators = parsed as Legislator[];
  return cachedLegislators;
}

/** Test-only hook to reset the in-process cache between test cases. */
export function __resetLegislatorsCacheForTests(): void {
  cachedLegislators = null;
}

export function findByBioguide(
  legislators: Legislator[],
  bioguideId: string,
): Legislator | null {
  return legislators.find((l) => l.id.bioguide === bioguideId) ?? null;
}

/**
 * ID-only reverse index: FEC candidate_id -> bioguide ID. Built by
 * flattening every legislator's id.fec list. Safe to flatten without an
 * office/year filter because fec_candidate_id values are already unique
 * per candidacy (assigned by the FEC) — if a given ID appears in a
 * legislator's list at all, it unambiguously belongs to that legislator,
 * regardless of which office or cycle they held it under.
 *
 * This is the crosswalk direction fetch_votes.ts actually uses: candidates
 * carry `fec_candidate_id` (from the entity spine, T02); this index answers
 * "is this candidate a sitting member of Congress, and if so, what's their
 * bioguide?" with zero name comparisons.
 */
export function buildFecToBioguideIndex(legislators: Legislator[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const legislator of legislators) {
    const bioguide = legislator.id.bioguide;
    if (!bioguide) continue;
    for (const fecId of legislator.id.fec ?? []) {
      map.set(fecId, bioguide);
    }
  }
  return map;
}

// ============================================================
// Forward direction: bioguide -> the correct 2026 FEC candidate_id
// ============================================================
//
// Spec B2 / DATA-SOURCES-2026-08-06.md §4: "id.fec is a list — pick the
// entry matching office (H/S) and election_years containing 2026."
// election_years is not present in congress-legislators itself (id.fec is
// a flat list of ID strings); it's a field on the FEC's own candidate
// detail resource (GET /v1/candidate/{candidate_id}/ -> results[0].office,
// results[0].election_years). selectFecCandidateId is the pure selection
// rule (unit-testable without network); resolveFecCandidateId does the FEC
// lookups needed to apply it. Not on fetch_votes.ts's primary path (that
// only needs the reverse index above) — provided for the forward direction
// the spec calls out explicitly, e.g. validating/backfilling a spine
// record's fec_candidate_id from a known bioguide.

export interface FecCandidateOption {
  candidateId: string;
  office: 'H' | 'S' | 'P';
  electionYears: number[];
}

/**
 * Pure selection rule: given the FEC candidate-detail info for every ID in
 * a legislator's id.fec list, pick the one for the requested office and
 * election year. Returns null when none match (e.g. a House-only member
 * with no Senate run, or a Senate member whose only House run predates
 * this legislator ever holding a Senate seat).
 */
export function selectFecCandidateId(
  options: FecCandidateOption[],
  office: 'H' | 'S',
  electionYear: number,
): string | null {
  const hit = options.find(
    (o) => o.office === office && o.electionYears.includes(electionYear),
  );
  return hit ? hit.candidateId : null;
}

async function fetchFecCandidateOption(candidateId: string): Promise<FecCandidateOption | null> {
  const key = requireEnv('FEC_API_KEY');
  const url = `https://api.open.fec.gov/v1/candidate/${candidateId}/?api_key=${key}`;
  const data = await fetchCached<{ results?: Array<Record<string, unknown>> }>(url, {
    cacheTag: `legislators:fec-candidate:${candidateId}`,
  });
  const r = data.results?.[0];
  if (!r) return null;
  const office = typeof r.office === 'string' ? r.office : candidateId[0];
  const electionYears = Array.isArray(r.election_years)
    ? r.election_years.map((y) => Number(y))
    : [];
  return {
    candidateId: typeof r.candidate_id === 'string' ? r.candidate_id : candidateId,
    office: office as 'H' | 'S' | 'P',
    electionYears,
  };
}

/**
 * Resolve a legislator's FEC candidate_id for a specific office + election
 * year by fetching FEC candidate detail for every ID in their id.fec list
 * and applying selectFecCandidateId. Requires FEC_API_KEY (fails loudly via
 * requireEnv if unset, same contract as every other FEC-calling client).
 */
export async function resolveFecCandidateId(
  legislator: Legislator,
  office: 'H' | 'S',
  electionYear: number,
): Promise<string | null> {
  const fecIds = legislator.id.fec ?? [];
  if (fecIds.length === 0) return null;
  const options: FecCandidateOption[] = [];
  for (const id of fecIds) {
    const option = await fetchFecCandidateOption(id);
    if (option) options.push(option);
  }
  return selectFecCandidateId(options, office, electionYear);
}
