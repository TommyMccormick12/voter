// Fetch the FL Division of Elections qualified-candidate roster and build
// the entity spine (Decision 5) for the 2026 federal primaries.
//
// Source: dos.elections.myflorida.com/candidates/downloadcanlist.asp
//   The public "Download Candidate List" page (downloadcanlist.asp) renders
//   a form whose real submit target is extractCanList.asp (POST, no session
//   cookie or CSRF token required — verified live 2026-08-06). Response is
//   tab-delimited text (Content-Type: application/tab-separated-values,
//   filename CandidateList.txt), header row included.
//
// Form fields (inspected live from the rendered form on downloadcanlist.asp,
// select name="elecID"/"office"/"status"/"cantype"):
//   elecID   — "20261103-GEN" is "2026 Election" (the Aug 18 primary +
//              Nov general cycle; there is no separate primary-only code).
//   office   — "FED" = Federal Offices. Confirmed live: this bucket returns
//              only OfficeCode USR (United States Representative) and USS
//              (United States Senator) for the 2026 cycle — no president on
//              a midterm ballot, so no further office-level filtering is
//              needed upstream, but we still filter defensively downstream.
//   status   — "All" (per T02: keep every status in the raw parse; the
//              spine applies its own status filter afterward).
//   cantype  — "STA" (State Candidates). Federal races qualify through the
//              state party structure in FL, so STA is correct and is also
//              the form's default.
//
// Column layout of the extract (26 tab-separated columns, header row present):
//   AcctNum, VoterID, ElectionID, OfficeCode, OfficeDesc, Juris1num,
//   Juris2num, StatusCode, StatusDesc, PartyCode, PartyDesc, NameLast,
//   NameFirst, NameMiddle, SuppressAddress, Addr1, Addr2, City, State, Zip,
//   County, Phone, TrsNameLast, TrsNameFirst, TrsNameMiddle, Email
//
// Notable finding: StatusCode has FOUR distinct values in the live 2026
// federal extract, not just Qualified/Did-Not-Qualify — DNQ (57), QUA
// (195), UNO (1), WIT (30). UNO = "Unopposed" is a status DISTINCT from
// QUA = "Qualified". The single UNO row is Maxwell Frost, FL-10 D — exactly
// the spec's A5 "no-primary" example.
//
// 2026-08-06 update (T03 roster rebuild): the spine now INCLUDES UNO rows
// alongside QUA rows, each tagged with `unopposed: true` on QUA rows this
// is always `false`. Spec A5 needs Frost's race to render as an
// informational "no primary" state rather than disappear, so excluding him
// from the spine (the prior behavior) was wrong: T03/T06 both depend on
// the spine carrying every candidate who has a real spot on the ballot,
// contested or not. See the run summary block at the bottom of main().
//
// There is no campaign-website column in the DOE extract, and the FEC
// /candidates/search response also carries no website field. campaign_website
// is therefore null for every spine row in this script — a later, separate
// step (spine-seeded campaign-site discovery, DATA-SOURCES-2026-08-06.md
// section 3) is responsible for filling it in. Do not guess a URL here.
//
// Usage: npx tsx scripts/ingest/fetch_doe_roster.ts

import '../_env';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { searchCandidates, type FecCandidate } from '../../src/lib/api-clients/fec';
import { stripTitles } from '../../src/lib/api-clients/names';

const DOE_FORM_URL = 'https://dos.elections.myflorida.com/candidates/extractCanList.asp';
const CYCLE = 2026;

const DOE_HEADERS = [
  'AcctNum',
  'VoterID',
  'ElectionID',
  'OfficeCode',
  'OfficeDesc',
  'Juris1num',
  'Juris2num',
  'StatusCode',
  'StatusDesc',
  'PartyCode',
  'PartyDesc',
  'NameLast',
  'NameFirst',
  'NameMiddle',
  'SuppressAddress',
  'Addr1',
  'Addr2',
  'City',
  'State',
  'Zip',
  'County',
  'Phone',
  'TrsNameLast',
  'TrsNameFirst',
  'TrsNameMiddle',
  'Email',
] as const;

type DoeRow = Record<(typeof DOE_HEADERS)[number], string>;

const FEDERAL_OFFICE_CODES = new Set(['USR', 'USS']);

interface SpineRow {
  doe_acct_num: string;
  doe_name: string;
  office: 'U.S. House' | 'U.S. Senate';
  district: string | null;
  party: string;
  status: string;
  /** True for StatusCode=UNO ("Unopposed") rows — a real ballot spot with
   * no primary contest (spec A5). False for StatusCode=QUA rows. */
  unopposed: boolean;
  campaign_website: string | null;
  fec_candidate_id: string | null;
  join_note: string | null;
}

/** POST the DOE candidate-download form and return the raw tab-delimited body. */
async function fetchDoeExtract(): Promise<string> {
  const body = new URLSearchParams({
    elecID: '20261103-GEN',
    office: 'FED',
    status: 'All',
    cantype: 'STA',
    FormSubmit: 'Download Candidate List',
  });

  console.log(`[doe] POST ${DOE_FORM_URL} (elecID=20261103-GEN, office=FED, status=All)`);
  const res = await fetch(DOE_FORM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Referer: 'https://dos.elections.myflorida.com/candidates/downloadcanlist.asp',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`DOE download failed: HTTP ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/** Manual tab-delimited parse. Header row is present and matches DOE_HEADERS. */
function parseDoeTsv(text: string): DoeRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) throw new Error('DOE extract was empty');

  const header = lines[0].split('\t');
  const missing = DOE_HEADERS.filter((h) => !header.includes(h));
  if (missing.length > 0) {
    throw new Error(
      `DOE extract header changed shape — missing columns: ${missing.join(', ')}. ` +
        `Got: ${header.join(', ')}`,
    );
  }

  const rows: DoeRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    const row = {} as DoeRow;
    for (let i = 0; i < header.length; i++) {
      const key = header[i] as (typeof DOE_HEADERS)[number];
      row[key] = (cells[i] ?? '').trim();
    }
    rows.push(row);
  }
  return rows;
}

function doeOfficeLabel(officeCode: string): 'U.S. House' | 'U.S. Senate' {
  if (officeCode === 'USR') return 'U.S. House';
  if (officeCode === 'USS') return 'U.S. Senate';
  throw new Error(`Unexpected federal office code: ${officeCode}`);
}

function doeOfficeToFec(officeCode: string): 'H' | 'S' {
  return officeCode === 'USR' ? 'H' : 'S';
}

/** DOE Juris1num is 3-char zero-padded ("007"). FEC district is 2-char
 * zero-padded ("07"). Convert; Senate rows have no district. */
function padDistrictForFec(juris1num: string): string {
  const n = parseInt(juris1num, 10);
  return String(n).padStart(2, '0');
}

function buildDoeName(row: DoeRow): string {
  const parts = [row.NameFirst, row.NameMiddle, row.NameLast].filter((p) => p.length > 0);
  return stripTitles(parts.join(' ')).replace(/\s+/g, ' ').trim();
}

/** FEC candidate `name` is "LAST, FIRST MIDDLE...". Split it. */
function fecNameParts(name: string): { last: string; rest: string } {
  const idx = name.indexOf(',');
  if (idx === -1) return { last: name.trim().toLowerCase(), rest: '' };
  return {
    last: name.slice(0, idx).trim().toLowerCase(),
    rest: name.slice(idx + 1).trim().toLowerCase(),
  };
}

function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

interface JoinResult {
  fecCandidateId: string | null;
  joinNote: string | null;
}

/** Join one Qualified DOE row to an FEC candidate_id. Exact-office match
 * (district/office/cycle) first, then last-name, then first-name to
 * disambiguate. Never guesses across an ambiguous set — records it instead. */
async function joinToFec(row: DoeRow, hasFecKey: boolean): Promise<JoinResult> {
  if (!hasFecKey) {
    return { fecCandidateId: null, joinNote: 'FEC_API_KEY not set; join skipped' };
  }

  const office = doeOfficeToFec(row.OfficeCode);
  const district = row.OfficeCode === 'USR' ? padDistrictForFec(row.Juris1num) : undefined;

  let candidates: FecCandidate[];
  try {
    candidates = await searchCandidates({ state: 'FL', district, office, cycle: CYCLE });
  } catch (err) {
    return {
      fecCandidateId: null,
      joinNote: `FEC search failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const inCycle = candidates.filter(
    (c) => c.cycles.includes(CYCLE) && c.active_through >= CYCLE,
  );
  const pool = inCycle.length > 0 ? inCycle : candidates;

  const doeLast = normalizeForCompare(stripTitles(row.NameLast));
  const doeFirst = normalizeForCompare(row.NameFirst);

  const exactLast = pool.filter((c) => normalizeForCompare(fecNameParts(c.name).last) === doeLast);

  const pick = (set: FecCandidate[], note: string | null): JoinResult => {
    if (set.length === 1) return { fecCandidateId: set[0].candidate_id, joinNote: note };
    if (set.length > 1) {
      const byFirst = set.filter((c) => {
        const rest = normalizeForCompare(fecNameParts(c.name).rest);
        return rest.startsWith(doeFirst) || doeFirst.startsWith(rest.slice(0, doeFirst.length));
      });
      if (byFirst.length === 1) {
        return { fecCandidateId: byFirst[0].candidate_id, joinNote: note };
      }
      const ids = set.map((c) => `${c.candidate_id} (${c.name})`).join('; ');
      return {
        fecCandidateId: null,
        joinNote: `ambiguous: ${set.length} FEC candidates matched district/office/cycle=${CYCLE} for last name "${row.NameLast}": ${ids}`,
      };
    }
    return { fecCandidateId: null, joinNote: null };
  };

  if (exactLast.length > 0) {
    return pick(exactLast, null);
  }

  // Fuzzy fallback: substring match on last name (handles hyphenation /
  // suffix noise), mirrors the approach in fetch_fec.ts.
  const fuzzy = pool.filter((c) => {
    const last = normalizeForCompare(fecNameParts(c.name).last);
    return last.length > 0 && (last.includes(doeLast) || doeLast.includes(last));
  });
  if (fuzzy.length > 0) {
    return pick(fuzzy, 'fuzzy last-name match (no exact last-name hit)');
  }

  return {
    fecCandidateId: null,
    joinNote: `no FEC candidate found for "${buildDoeName(row)}" in ${office}/${
      district ?? 'statewide'
    }/cycle=${CYCLE} (${pool.length} FEC candidates searched in that race)`,
  };
}

// The seven candidates flagged in DECISIONS-2026-08-06.md / SPEC A1 as
// confirmed-wrong on the live site. Matched by last name against the FULL
// raw parse (any status) so a near-miss (different first name, same
// surname) is visible rather than silently absent.
const SEVEN_CHECK: Array<{ label: string; lastName: string }> = [
  { label: 'Marco Rubio', lastName: 'Rubio' },
  { label: 'Rick Scott', lastName: 'Scott' },
  { label: 'Byron Donalds', lastName: 'Donalds' },
  { label: 'Vernon Buchanan', lastName: 'Buchanan' },
  { label: 'Daniel Webster (FL-11)', lastName: 'Webster' },
  { label: 'Anthony Sabatini', lastName: 'Sabatini' },
  { label: 'Alan Grayson', lastName: 'Grayson' },
];

function reportSeven(allRows: DoeRow[]): void {
  console.log('\n[doe] === T01 verification: seven confirmed-wrong candidates ===');
  for (const target of SEVEN_CHECK) {
    const matches = allRows.filter(
      (r) => normalizeForCompare(r.NameLast) === normalizeForCompare(target.lastName),
    );
    if (matches.length === 0) {
      console.log(`  ${target.label}: NOT on the federal roster (no row for last name "${target.lastName}").`);
      continue;
    }
    for (const m of matches) {
      const name = buildDoeName(m);
      console.log(
        `  ${target.label}: found row "${name}" — ${m.OfficeDesc} district ${m.Juris1num || '(statewide)'}, ` +
          `party ${m.PartyDesc} (${m.PartyCode}), status ${m.StatusDesc} (${m.StatusCode}).`,
      );
    }
  }
  console.log('[doe] === end T01 verification ===\n');
}

async function main() {
  const rawText = await fetchDoeExtract();
  const allRows = parseDoeTsv(rawText);
  console.log(`[doe] parsed ${allRows.length} raw rows (all statuses, all federal offices)`);

  const federalRows = allRows.filter((r) => FEDERAL_OFFICE_CODES.has(r.OfficeCode));
  console.log(`[doe] ${federalRows.length} rows are US House / US Senate`);

  const statusCounts = new Map<string, number>();
  for (const r of federalRows) {
    statusCounts.set(r.StatusDesc, (statusCounts.get(r.StatusDesc) ?? 0) + 1);
  }
  console.log('[doe] status breakdown:', Object.fromEntries(statusCounts));

  reportSeven(allRows);

  // T03 (2026-08-06): the spine includes both Qualified (QUA) and
  // Unopposed (UNO) rows. QUA is a normal primary contestant; UNO is a
  // real ballot spot with no primary (spec A5) — both need a spine entry
  // so downstream fixture builds don't have to special-case a candidate
  // who is missing from this file entirely. `unopposed` on each row tells
  // callers which case they're in.
  const qualified = federalRows.filter(
    (r) => r.StatusCode === 'QUA' || r.StatusCode === 'UNO',
  );
  console.log(
    `[doe] ${qualified.length} Qualified+Unopposed federal rows will form the spine`,
  );

  const unopposed = federalRows.filter((r) => r.StatusCode === 'UNO');
  if (unopposed.length > 0) {
    console.log(
      `[doe] ${unopposed.length} row(s) have status "Unopposed" (UNO), distinct from ` +
        `"Qualified" (QUA), and are INCLUDED in spine-2026.json with unopposed:true. Spec A5 ` +
        `renders these as a "no primary" informational race rather than hiding them. Names: ` +
        unopposed.map((r) => `${buildDoeName(r)} (${r.OfficeDesc} ${r.Juris1num}, ${r.PartyDesc})`).join(', '),
    );
  }

  const hasFecKey = !!process.env.FEC_API_KEY;
  if (!hasFecKey) {
    console.log('[doe] FEC_API_KEY not set — all fec_candidate_id values will be null.');
  }

  const spine: SpineRow[] = [];
  let joinedCount = 0;
  let ambiguousCount = 0;
  let unmatchedCount = 0;

  for (const row of qualified) {
    const { fecCandidateId, joinNote } = await joinToFec(row, hasFecKey);
    if (fecCandidateId) joinedCount++;
    else if (joinNote?.startsWith('ambiguous')) ambiguousCount++;
    else if (joinNote) unmatchedCount++;

    spine.push({
      doe_acct_num: row.AcctNum,
      doe_name: buildDoeName(row),
      office: doeOfficeLabel(row.OfficeCode),
      district: row.OfficeCode === 'USR' ? padDistrictForFec(row.Juris1num) : null,
      party: row.PartyCode,
      status: row.StatusDesc,
      unopposed: row.StatusCode === 'UNO',
      campaign_website: null,
      fec_candidate_id: fecCandidateId,
      join_note: joinNote,
    });
  }

  const byOffice = new Map<string, number>();
  for (const s of spine) byOffice.set(s.office, (byOffice.get(s.office) ?? 0) + 1);

  const outPath = join(process.cwd(), 'supabase', 'seed', 'spine-2026.json');
  writeFileSync(outPath, JSON.stringify(spine, null, 2));

  console.log(`\n[doe] wrote ${spine.length} spine rows to ${outPath}`);
  console.log('[doe] qualified count by office:', Object.fromEntries(byOffice));
  console.log(
    `[doe] FEC join: ${joinedCount} matched, ${ambiguousCount} ambiguous, ${unmatchedCount} unmatched` +
      (hasFecKey ? '' : ' (key missing — all skipped)'),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
