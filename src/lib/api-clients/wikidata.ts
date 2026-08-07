// Wikidata gate — resolves a candidate name to a verified Wikidata QID
// before any Wikipedia page read. This closes the wrong-person bug class
// found in the 2026-08-06 data audit: the FL-11 "Daniel Webster" fixture
// carried the bio of the 1782-1852 Massachusetts statesman, because the
// old pipeline picked the first Wikipedia page a name search returned.
//
// Contract (Spec B1.2 / Ticket T09):
//   1. Search Wikidata by candidate name.
//   2. Verify claims on each hit: P3602 (candidacy in election) must
//      reference an election item matching the candidate's cycle, office,
//      and state (and district, for House races); OR P768 (electoral
//      district) must reference the candidate's district.
//   3. Sanity checks apply even after a claims match: P570 (death date)
//      before the election cycle, or P569 (birth date) implying an
//      implausible candidacy age, reject that QID.
//   4. No QID survives steps 2-3 = an explicit miss. The caller
//      (scripts/ingest/fetch_platform.ts) must not fetch anything from
//      Wikipedia for that candidate.
//
// Docs: https://www.wikidata.org/w/api.php
// Auth: none required.
// Rate limit: no documented hard cap; fetchCached throttles + disk-caches
// like every other client in this module.

import { fetchCached } from './base';

const BASE = 'https://www.wikidata.org/w/api.php';

/** Minimum plausible age at the election, by office. Used against P569. */
const MIN_CANDIDACY_AGE: Record<'U.S. House' | 'U.S. Senate', number> = {
  'U.S. House': 25,
  'U.S. Senate': 30,
};

// Implausibly old for an active candidate. Catches a claims match on a
// historical namesake even in the (rare) case no death date is recorded.
const MAX_PLAUSIBLE_AGE = 100;

// Extend as the ingest pipeline covers more states than FL.
const STATE_NAMES: Record<string, string> = {
  FL: 'Florida',
};

export interface CandidacyQuery {
  /** Full display name as filed with the FEC/DOE. */
  name: string;
  office: 'U.S. House' | 'U.S. Senate';
  /** Two-letter state code, e.g. "FL". */
  state: string;
  /** District number as a string, e.g. "11". Null for Senate races. */
  district: string | null;
  /** Election cycle year, e.g. 2026. */
  cycle: number;
}

export type WikidataGateResult =
  | {
      gated: false;
      qid: string;
      matchedVia: 'P3602' | 'P768';
      /** English Wikipedia page title from the entity's sitelink, if any. */
      enwikiTitle: string | null;
    }
  | {
      gated: true;
      reason: string;
    };

interface SearchHit {
  id: string;
  label: string;
  description: string;
}

interface WikidataDataValue {
  id?: string;
  time?: string;
}

interface WikidataClaimSnak {
  mainsnak?: {
    datavalue?: {
      value?: WikidataDataValue | string;
    };
  };
}

interface RawEntity {
  id: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, WikidataClaimSnak[]>;
  sitelinks?: Record<string, { title: string }>;
}

interface ParsedEntity {
  id: string;
  candidacyElectionIds: string[]; // P3602 claim targets
  electoralDistrictIds: string[]; // P768 claim targets
  birthYear: number | null; // P569
  deathYear: number | null; // P570
  enwikiTitle: string | null;
}

// ============================================================
// Wikidata API calls
// ============================================================

/** Name search over Wikidata entities. Returns up to 10 candidate QIDs. */
export async function searchWikidataEntities(name: string): Promise<SearchHit[]> {
  const qs = new URLSearchParams({
    action: 'wbsearchentities',
    search: name,
    language: 'en',
    type: 'item',
    limit: '10',
    format: 'json',
  });
  const url = `${BASE}?${qs.toString()}`;
  const data = await fetchCached<{
    search?: Array<{ id: string; label?: string; description?: string }>;
  }>(url, { cacheTag: `wikidata:search:${name}` });
  return (data.search ?? []).map((r) => ({
    id: r.id,
    label: r.label ?? '',
    description: r.description ?? '',
  }));
}

async function getRawEntities(ids: string[]): Promise<Record<string, RawEntity>> {
  if (ids.length === 0) return {};
  const qs = new URLSearchParams({
    action: 'wbgetentities',
    ids: ids.join('|'),
    props: 'claims|labels|descriptions|sitelinks',
    languages: 'en',
    format: 'json',
  });
  const url = `${BASE}?${qs.toString()}`;
  const data = await fetchCached<{ entities?: Record<string, RawEntity> }>(url, {
    cacheTag: `wikidata:entities:${ids.slice().sort().join(',')}`,
  });
  return data.entities ?? {};
}

/** Batch label+description lookup for referenced election/district items. */
async function getLabelsOnly(
  ids: string[],
): Promise<Record<string, { label: string; description: string }>> {
  if (ids.length === 0) return {};
  const qs = new URLSearchParams({
    action: 'wbgetentities',
    ids: ids.join('|'),
    props: 'labels|descriptions',
    languages: 'en',
    format: 'json',
  });
  const url = `${BASE}?${qs.toString()}`;
  const data = await fetchCached<{ entities?: Record<string, RawEntity> }>(url, {
    cacheTag: `wikidata:labels:${ids.slice().sort().join(',')}`,
  });
  const out: Record<string, { label: string; description: string }> = {};
  for (const [id, e] of Object.entries(data.entities ?? {})) {
    out[id] = {
      label: e.labels?.en?.value ?? '',
      description: e.descriptions?.en?.value ?? '',
    };
  }
  return out;
}

// ============================================================
// Parsing
// ============================================================

function claimTargetIds(claims: WikidataClaimSnak[] | undefined): string[] {
  if (!claims) return [];
  const ids: string[] = [];
  for (const c of claims) {
    const v = c.mainsnak?.datavalue?.value;
    if (v && typeof v === 'object' && typeof v.id === 'string') ids.push(v.id);
  }
  return ids;
}

/** Wikidata time format: "+1852-10-24T00:00:00Z" (sign + zero-padded year). */
function claimYear(claims: WikidataClaimSnak[] | undefined): number | null {
  if (!claims || claims.length === 0) return null;
  const v = claims[0].mainsnak?.datavalue?.value;
  if (!v || typeof v !== 'object' || typeof v.time !== 'string') return null;
  const m = v.time.match(/^([+-])(\d+)-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = Number.parseInt(m[2], 10);
  return m[1] === '-' ? -year : year;
}

function parseEntity(raw: RawEntity): ParsedEntity {
  return {
    id: raw.id,
    candidacyElectionIds: claimTargetIds(raw.claims?.P3602),
    electoralDistrictIds: claimTargetIds(raw.claims?.P768),
    birthYear: claimYear(raw.claims?.P569),
    deathYear: claimYear(raw.claims?.P570),
    enwikiTitle: raw.sitelinks?.enwiki?.title ?? null,
  };
}

// ============================================================
// Claim verification — does a referenced item actually match this race?
// ============================================================

function districtPattern(district: string): RegExp {
  const d = String(Number.parseInt(district, 10));
  return new RegExp(`district\\s*0*${d}\\b|\\b0*${d}(?:st|nd|rd|th)\\b`, 'i');
}

/**
 * Does a P3602 (candidacy in election) target's label/description read as
 * the candidate's own race? Requires the cycle year, the state name, the
 * office keyword, and (for House races) the district number to all appear.
 */
function electionMatchesRace(labelAndDescription: string, query: CandidacyQuery): boolean {
  const text = labelAndDescription.toLowerCase();
  if (!text.includes(String(query.cycle))) return false;

  const stateName = (STATE_NAMES[query.state.toUpperCase()] ?? query.state).toLowerCase();
  if (!text.includes(stateName)) return false;

  const officePattern = query.office === 'U.S. Senate' ? /senate/ : /house of representatives/;
  if (!officePattern.test(text)) return false;

  if (query.district && !districtPattern(query.district).test(text)) return false;

  return true;
}

/**
 * Does a P768 (electoral district) target's label/description read as the
 * candidate's own district? House races only — Senate has no district.
 */
function districtMatchesRace(labelAndDescription: string, query: CandidacyQuery): boolean {
  if (!query.district) return false;
  const text = labelAndDescription.toLowerCase();
  const stateName = (STATE_NAMES[query.state.toUpperCase()] ?? query.state).toLowerCase();
  if (!text.includes(stateName)) return false;
  return districtPattern(query.district).test(text);
}

// ============================================================
// Sanity checks — applied even after a claims match
// ============================================================

interface SanityResult {
  ok: boolean;
  reason?: string;
}

function sanityCheck(entity: ParsedEntity, query: CandidacyQuery): SanityResult {
  if (entity.deathYear !== null && entity.deathYear < query.cycle) {
    return {
      ok: false,
      reason: `${entity.id} has a death date (${entity.deathYear}) before the ${query.cycle} cycle`,
    };
  }

  if (entity.birthYear !== null) {
    const age = query.cycle - entity.birthYear;
    const minAge = MIN_CANDIDACY_AGE[query.office];
    if (age < minAge) {
      return {
        ok: false,
        reason: `${entity.id} would be ${age} years old in ${query.cycle}, below the ${minAge}-year minimum for ${query.office}`,
      };
    }
    if (age > MAX_PLAUSIBLE_AGE) {
      return {
        ok: false,
        reason: `${entity.id} would be ${age} years old in ${query.cycle}, an implausible candidacy age`,
      };
    }
  }

  return { ok: true };
}

// ============================================================
// The gate
// ============================================================

/**
 * Resolve a candidate name to a Wikidata QID whose claims match the
 * candidacy, or return an explicit miss. Never throws on a miss — the
 * caller checks `gated` and skips Wikipedia entirely when true.
 */
export async function resolveCandidacyQid(query: CandidacyQuery): Promise<WikidataGateResult> {
  const hits = await searchWikidataEntities(query.name);
  if (hits.length === 0) {
    return { gated: true, reason: `no Wikidata entity found for "${query.name}"` };
  }

  const rawEntities = await getRawEntities(hits.map((h) => h.id));
  const entities = hits
    .map((h) => rawEntities[h.id])
    .filter((e): e is RawEntity => Boolean(e))
    .map(parseEntity);

  // Batch-fetch labels for every referenced election/district item across
  // all hits in one call, rather than one lookup per claim.
  const referencedIds = Array.from(
    new Set(entities.flatMap((e) => [...e.candidacyElectionIds, ...e.electoralDistrictIds])),
  );
  const referencedLabels = await getLabelsOnly(referencedIds);

  const failures: string[] = [];

  for (const entity of entities) {
    let matchedVia: 'P3602' | 'P768' | null = null;

    for (const electionId of entity.candidacyElectionIds) {
      const ref = referencedLabels[electionId];
      if (!ref) continue;
      if (electionMatchesRace(`${ref.label} ${ref.description}`, query)) {
        matchedVia = 'P3602';
        break;
      }
    }

    if (!matchedVia) {
      for (const districtId of entity.electoralDistrictIds) {
        const ref = referencedLabels[districtId];
        if (!ref) continue;
        if (districtMatchesRace(`${ref.label} ${ref.description}`, query)) {
          matchedVia = 'P768';
          break;
        }
      }
    }

    if (!matchedVia) continue;

    const sanity = sanityCheck(entity, query);
    if (!sanity.ok) {
      failures.push(sanity.reason ?? `${entity.id} failed a sanity check`);
      continue;
    }

    return {
      gated: false,
      qid: entity.id,
      matchedVia,
      enwikiTitle: entity.enwikiTitle,
    };
  }

  const reason =
    failures.length > 0
      ? `no candidate QID for "${query.name}" survived verification: ${failures.join('; ')}`
      : `no Wikidata QID for "${query.name}" carries a P3602/P768 claim matching ${query.office} ${query.state}${query.district ? '-' + query.district : ''} (${query.cycle})`;

  return { gated: true, reason };
}
