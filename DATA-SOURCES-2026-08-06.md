# Data source evaluation — 2026-08-06

Four research agents evaluated replacement sources for every data domain, checked against availability in August 2026. Conclusion: the current stack's failures are fixable at the source level. Recommended stack below; per-domain detail follows.

## Recommended stack (summary)

| Domain | Current (broken) | Recommended | Cost |
|---|---|---|---|
| Who is on the ballot | FEC registrations | **FL Division of Elections candidate download** (Qualified status, new-map districts); Ballotpedia as cross-check | Free |
| District routing | Hand-made ZIP file, 2022 map | **Address-based lookup**: FL Senate EOGPCRP2026 shapefile + Census geocoder + point-in-polygon; own ZIP precompute for convenience | Free |
| Candidate stances | Wikipedia + campaign scrape + NewsAPI | **Entity spine (DOE+FEC IDs)** → Ballotpedia Candidate Connection (paid) → spine-seeded campaign scrape → GDELT news mining; Wikipedia gated by Wikidata QID | Free except Ballotpedia |
| Voting records | GovTrack scrape, name-matched | **Congress.gov API** (House, bioguide-keyed) + **Voteview** (Senate + backfill); IDs via unitedstates/congress-legislators | Free |
| Money | FEC API, name-matched, cycle-ambiguous | **Same FEC API, used correctly**: `/candidate/{id}/totals?cycle=2026`, ID-joined, `coverage_end_date` displayed | Free |

## 1. Ballot roster — FL Division of Elections (fixes the candidacy root cause)

- Tab-delimited download of every candidate with a **status field** (Qualified / Withdrawn / Did Not Qualify), party, and district: `dos.elections.myflorida.com/candidates/downloadcanlist.asp` (form POST; trivial to script; free).
- Filter to **Qualified** = the actual August 18 ballot. Retirees, withdrawals, non-qualifiers, and wrong-office filings (Rubio, Scott, Donalds, Buchanan, Webster, Sabatini, Grayson) never reach Qualified status.
- District field already encodes the new 28-district map because qualifying ran under it.
- Cross-check: Ballotpedia (paid API/bulk, human-curated, FL 2026 in full coverage). Zero-budget alternative: their public pages + county sample ballots.
- Avoid Google Civic as a roster source (Representatives API shut down April 2025; ballot data arrives late and varies by state).

## 2. District routing — address-based on the official shapefile (fixes the ZIP root cause)

- **ZIP-only cannot be made correct.** No ZIP→district product carries the new FL map (HUD crosswalk and Census current layers still serve the 119th-Congress map; 120th products land ~2027).
- Fastest correct path (about a day of work):
  1. Download the official **EOGPCRP2026** shapefile from flsenate.gov (Redistricting → Congressional); convert to GeoJSON (28 polygons, small).
  2. Geocode the voter's street address with the free keyless Census geocoder (`Public_AR_Current`) → lat/lon only (ignore its district field — old map).
  3. Point-in-polygon in an API route (turf.js). Zero per-lookup cost.
- Managed alternative: Geocodio `cd120` append (~$1/1,000 lookups; verify FL is live with test addresses before relying on it).
- Keep ZIP as convenience entry: precompute ZIP→district(s) by intersecting Census ZCTAs with the new shapefile; single-district ZIPs answer directly, split ZIPs ask for the address.
- UI note: HB 1-D litigation continues on the merits; re-check if a court alters the map.

## 3. Stances — spine-first, then layered sources (fixes wrong-person + thin challengers)

- **Entity spine first:** every candidate record starts from the FL DOE roster row (legal name, district, status, campaign website) joined to an FEC `candidate_id` (via `/candidates/search` with state/district/office/cycle). Every stance must attach to a spine record. This alone kills the wrong-person bug class.
- **Primary:** Ballotpedia **Candidate Connection** survey (paid API / bulk). Self-authored answers; response skews toward low-profile challengers — exactly the coverage gap. ~1 in 5 respond.
- **Secondary:** campaign-site scraping (keep Playwright) but seed URLs from the spine, never from search results.
- **Tertiary:** **GDELT DOC 2.0** (free, no key, 15-min updates) for statement mining, domain-pinned to FL outlets (floridapolitics.com is the highest-yield for obscure candidates); fetch full text ourselves. Replaces NewsAPI. NewsData.io free tier as backstop. (Bing News is dead since Aug 2025; Brave dropped its free tier.)
- **Wikipedia gated:** resolve a Wikidata QID whose P3602 (candidacy) / P768 (district) matches the race before reading any Wikipedia page. No matching QID = no Wikipedia data — an explicit miss instead of a silent wrong-person grab.
- Vote Smart API technically alive but decaying (2014-era docs, deficit org, ~20% response) — incumbent enrichment only. OnTheIssues: no API, restrictive terms. ISideWith: inaccessible.

## 4. Voting records — official APIs, ID-joined (fixes the name-matching root cause)

- **House:** Congress.gov official API `/house-vote/{congress}/{session}/{vote}/members` — each row carries a **bioguideID**. Free key, 5,000 req/hr. Coverage 117th Congress (2021) forward.
- **Senate:** not in the Congress.gov API yet. Use **Voteview** (voteview.com/data — both chambers, updated live, CSVs include bioguide_id) or self-host the unitedstates/congress scrapers.
- GovTrack's public API/bulk data ended in 2016-17 — the current scrape was always unsupported. ProPublica Congress API is dead (July 2024).
- **ID crosswalk:** unitedstates/congress-legislators YAML (actively maintained; last commit July 2026). `id.bioguide` is the primary key; `id.fec` is a *list* — pick the entry matching office (H/S) and `election_years` containing 2026.
- Challengers (no bioguide): resolve to an FEC candidate_id once at ingest, store it, query by ID forever. No name matching at any stage.

## 5. Money — same FEC API, used correctly (fixes staleness + wrong-committee)

- `/candidate/{candidate_id}/totals/?cycle=2026` — consolidates all authorized committees, de-duplicated. For Senate, `election_full=true` + `election_year=2026` controls 6-year vs 2-year aggregation.
- Never omit `cycle` (that's how prior-cycle money leaked in). If 2026 returns nothing, show "no 2026 filings yet" — never fall back silently.
- Render `coverage_end_date` next to every dollar figure.
- **Timing:** July Quarterlies (through June 30) are fully processed now. The FL 12-day pre-primary report (through July 29) e-files **today, Aug 6** — totals will jump within a nightly cycle or two. Re-pull money after Aug 8 for the freshest pre-primary numbers; `/efile/reports/house-senate/` shows raw filings within minutes.

## Cost summary

Everything above is free except Ballotpedia (sales-quoted; ask about civic-project pricing) and optional Geocodio (~$1/1,000). The current NewsAPI dependency can be dropped.
