# Data accuracy audit — 2026-08-06

**Method:** 13-agent swarm. Nine validators checked the seeded data against live sources (Ballotpedia, FEC, GovTrack, Florida news) and against the pipeline code. Every critical/high finding was then re-derived by independent adversarial verifiers. Result: 73 findings; 24 verified (23 CONFIRMED, 1 UNCLEAR); 17 critical/high findings remain unverified due to a verification cap but follow the same confirmed patterns.

**Headline:** the live site is materially wrong about the August 18 ballot. This is not a scraping-quality problem that can be patched candidate-by-candidate. Two world events invalidated the entire May 2026 snapshot, and several pipeline bugs corrupted data on top of that.

## Root cause 1 — the data is frozen in May 2026; the world changed twice

1. **Florida's mid-decade redistricting** (new congressional map signed 2026-05-04, upheld by the FL Supreme Court 2026-06-10). The entire race structure — district numbers, candidate-to-district assignment, ZIP-to-district routing — uses the pre-2026 map. On the real ballot: Moskowitz runs in the new CD-25, Wasserman Schultz in the new CD-20, Frankel in the new CD-23. The site's `race-fl-23-d` shows two "incumbents" (Frankel + Moskowitz) in one impossible race. **CONFIRMED.**
2. **The June 12 qualifying deadline** finalized every 2026 FL ballot. The rosters were never reconciled against it. Confirmed consequences:
   - FL-11 R: both live candidates are gone (Webster retired 4/28; Sabatini withdrew at qualifying). The real contest — Carey Baker vs Joe Strada — is entirely absent.
   - FL-10 D: shown as a primary; Frost qualified unopposed, so no primary exists.
   - FL-16 R: Buchanan retired in January; shown as active incumbent.
   - FL-19 R: Donalds is running for Governor, not the House; shown as the sole House candidate.
   - Senate D: Grayson failed to qualify (now running in FL-7); real primary is Vindman vs Nixon only.

## Root cause 2 — "FEC filing" was treated as "actual candidacy"

The roster was built from FEC candidate registrations. An FEC filing proves a committee exists, not a live campaign. No step checked withdrawals, retirements, office changes, or resignations. Worst confirmed cases:

- **Marco Rubio** live as a 2026 Senate candidate. He resigned in January 2025 to become Secretary of State — the special election exists *because* he left. His own seeded bio says "Secretary of State"; the fixture contradicts itself.
- **Rick Scott** live as an incumbent Senate candidate. His seat was decided in 2024 and is not up until 2030. Both he and Moody are marked incumbent in the same race.
- Trailing prior-cycle money booked as 2026 fundraising (Scott $1.46M; Grayson's $178K likely from his 2022 committee — UNCLEAR at FEC level).

## Root cause 3 — pipeline bugs corrupted what was ingested

With code locations, from the pipeline root-cause agent:

1. **Title leakage in names** (`src/lib/api-clients/names.ts` + `fetch_fec.ts`): FEC names like "SCOTT, RICK SEN" produce display names and permanent slugs "Rick Sen Scott", "Scott Mr. Franklin". 33 more title-leak cases on inactive candidates.
2. **Wrong-person Wikipedia resolution** (`fetch_platform.ts` / `wikipedia.ts`): FL-11's Daniel Webster carries the bio of the 19th-century statesman (1782–1852) and a C-SPAN history video as his campaign site — cited as a stance source. Inactive candidates got an ad agency, a playwright, and generic election articles as bios.
3. **Name-only member matching** (`govtrack.ts` `matchRoleByName`): first names of ≤2 chars are treated as initials, enabling wrong-person matches; district is never used. Confirmed: Royal Webster (D challenger) carries Daniel Webster's `govtrack_id` and a stance claiming a YEA vote he never cast.
4. **Substring FEC matching** (`fetch_fec.ts`): bidirectional substring name match can assign one candidate's money and FEC ID to another. Related: Joshua Weil appears twice in one race under two FEC IDs (one row $0, the other $15.9M — the largest number in the dataset); Angela Walls-Windhauser also duplicated.
5. **Incumbent flag from name match** (`fetch_votes.ts`): GovTrack match silently overwrites FEC's incumbent signal in both directions.
6. **Silent failure everywhere**: seeding is delete-then-warn-and-continue (`seed_candidates.ts`) so a failed child insert leaves a live candidate with emptied records; 20 Senate voting entries have bill_id `vote-undefined` (literal JS interpolation); 89 bill/candidate pairs show both YEA and NAY on the same bill; 7 of 20 live candidates violate the documented ≥3-stances activation threshold; byte-identical duplicate rows in 4 fixtures; 5 slugs exist in two races each (breaks unique-slug routing/upserts).

## Root cause 4 — the ZIP crosswalk is not what everyone thinks it is

`supabase/seed/zip-districts.json` contains a `_note` admitting it is a **hand-mapped sample from public 2022 redistricting maps** — not the HUD USPS crosswalk the pipeline and docs assume. Confirmed wrong routing even on the old map: ZIP 33142 (Miami) sent to FL-26 though 71% of it is FL-24; ZIP 32822 (Orlando) sent to FL-09 though 67% is FL-10. Split ZIPs are flattened with no disambiguation. And all of it targets the superseded map (see root cause 1).

## What checked out

- The August 18, 2026 primary date is correct.
- Frost's, Salazar's, Gimenez's, Luna's, Lee's own identity facts (party, district on old map, incumbency) are correct; several fundraising figures are in range (Moody $8.4M, Vindman's is real but stale — he's at ~$16.7M now, double the shown figure).
- Citation validation (`curate.ts`) largely worked: exactly one broken track-record citation in the dataset (Royal Webster, itself downstream of the govtrack bug).

## Recommendation

Do not patch rows. Rebuild the dataset post-qualifying on the new map:

1. **Immediate (production risk):** the FL-11, FL-23-D, FL-25-D, Senate-R rosters and the Rubio/Scott/Donalds/Webster/Buchanan/Sabatini/Grayson candidacies are wrong on the live site today. Deactivating wrong candidates is a data-only operation (`active=false` + reseed) and needs no code change.
2. **Re-ingest against the certified qualified-candidate list** (FL Division of Elections), not FEC registrations. Qualifying lists are the ground truth for who is on the ballot.
3. **Rebuild districts and ZIP routing on the 2026 map**, from a real source (Census/state shapefiles or the actual HUD crosswalk), with split-ZIP disambiguation (ask for street address or show both districts' races).
4. **Fix the four pipeline bug classes** (names, Wikipedia disambiguation, member matching by ID not name, FEC matching by candidate ID) and make every silent failure loud, per the Ballot Match standards.
5. **Add a freshness contract:** every candidate row carries `verified_at`; anything older than N days can't be `active` without re-verification. A world-event check (redistricting, withdrawal) belongs in the activation gate.
