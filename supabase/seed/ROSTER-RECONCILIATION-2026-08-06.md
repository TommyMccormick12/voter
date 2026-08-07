# Roster reconciliation — 2026-08-06 (T03 / T13)

Scope: rebuild the race and candidate fixtures in `supabase/seed/candidates/*.partial.json`
from `supabase/seed/spine-2026.json` (the FL DOE qualified-candidate spine, T02),
on the 2026 28-district map. This report is written for the T26 adversarial
verifier: every claim below is either a direct read of `spine-2026.json` or a
mechanical property of the rebuild script, not a memory-based guess.

Owner: this ticket touches only `supabase/seed/candidates/*.partial.json`,
`supabase/seed/spine-2026.json`, and `scripts/ingest/fetch_doe_roster.ts`. It
does not touch `scripts/seed/**`, `src/**`, or `package.json`.

## Executive summary

| Metric | Before | After |
|---|---|---|
| Race fixtures | 36 | 57 |
| Candidate rows | 171 (including 5 byte-identical duplicates and 5 dual-race slugs) | 165 (one row per D/R spine candidate) |
| Races removed | — | 1 (`race-fl-10-r-2026` — no REP qualified) |
| Races added | — | 22 (districts 01–08, 12, 14 had zero prior fixtures; plus `race-fl-24-r-2026` and `race-fl-26-d-2026`, whose other party already existed) |
| Candidates carried over (identity confirmed) | — | 79 |
| Candidates newly minted (minimal, spine-only, inactive) | — | 86 |
| Candidates dropped (absent from spine) | — | 81, including 6 of the 7 confirmed-wrong slugs |
| Dual-race slugs (T13) | 5 | 0 (all resolved by construction) |
| Byte-identical duplicate rows (T13) | 5 rows across 4 files | 0 |
| Incumbent flags after rebuild | 19 (2 races had 2 "incumbents" each — the redistricting bug) | 14, unique per race |

Method: a deterministic script (not manual per-candidate editing) grouped every
DEM/REP spine row into its target race (`race-fl-<district>-<party>-2026` or
`race-fl-sen-<party>-2026`), then matched each spine row to pre-rebuild
fixture data **only** via an exact `fec_candidate_id` match (plus one
explicit, documented exception — Alan Grayson, see judgment call J1). Race
membership is 100% spine-driven: a fixture race exists if and only if the
spine has ≥1 Qualified or Unopposed DEM/REP row for that district+party: no
race was hand-picked or hand-edited. This means the diagnostic findings
in `DATA-AUDIT-2026-08-06.md` (Moskowitz→CD-25, Wasserman Schultz→CD-20,
Frankel stays CD-23, FL-11 R now Baker/Strada, Senate D now Vindman/Nixon
only) all fell out of the join automatically — none were special-cased in
code, which is itself a form of independent confirmation that the spine
and the audit agree. Non-major-party spine rows (NPA, WRI, LPF, IND, FFP —
31 of 196 rows) never form a primary and are excluded from every race, per
existing product scope (every race is `election_type='primary'`).

## What changed and why (traceable to source documents)

1. **FL-10 R removed.** Zero DEM or REP candidates qualified in FL-10 for
   U.S. House on the new map; the only qualifier is Maxwell Frost (DEM,
   Unopposed). `race-fl-10-r-2026.partial.json` deleted (its 4 prior
   candidates — Farber, Montague, Walls-Windhauser, White — are absent
   from the spine entirely; see Appendix E).
2. **FL-10 D gets the no-primary informational state (spec A5, Decision 9).**
   `race-fl-10-d-2026.partial.json` now carries `race.no_primary: true` and
   `race.no_primary_note: "No primary — Maxwell Alejandro Frost qualified
   unopposed and advances"`. Frost's candidate row also carries
   `unopposed: true`. His existing active record (7 stances) is preserved
   unchanged — the scorecard stays viewable per Decision 9.
3. **22 new race fixtures created** for districts that had zero prior
   fixtures (01–08, 12, 14 — the FL DOE spine has candidates there; the
   pre-rebuild fixture set simply never covered them) plus the previously
   missing "other party" fixture for FL-24 (R) and FL-26 (D). All
   candidates in brand-new races are minimal, spine-only, `active: false`
   records — no stances, bios, donors, or votes are authored (out of
   scope per this ticket; stance authoring is a separate follow-up run).
4. **Redistricting moves resolved via FEC id, matching DATA-AUDIT-2026-08-06.md
   root cause 1 exactly:**
   - Jared Moskowitz (`H2FL22171`): `race-fl-23-d-2026` → `race-fl-25-d-2026`.
   - Debbie Wasserman Schultz (`H4FL20023`): `race-fl-25-d-2026` → `race-fl-20-d-2026`.
   - Lois Frankel (`H2FL14053`): stays `race-fl-23-d-2026` (same district
     both before and after).
   - The pre-rebuild "two incumbents in one impossible race"
     (`race-fl-23-d-2026` showing both Frankel and Moskowitz as
     `incumbent: true`) no longer exists: each now has exactly one race,
     and the incumbent flag traveled with the correct person.
   - Six further FEC-id-matched moves were found beyond the three the audit
     named explicitly (Deborah Adeimy, Paola Branda, Lateresa Jones:
     `race-fl-22-r` → `race-fl-23-r`/`race-fl-20-r`; Pia Dandiya:
     `race-fl-21-d` → `race-fl-22-d`; Rudolph Moise: `race-fl-20-d` →
     `race-fl-24-d`; Joe Kaufman, Darren McAuley: similar single-district
     shifts). None of these six were incumbents, so they carry no
     incumbency risk, but see judgment call J3 for the general rule this
     relies on. Full list: Appendix C, "District moved = yes" rows.
5. **Senate D contracts from 15 candidates to 2** (Vindman, Nixon), matching
   `DATA-AUDIT-2026-08-06.md`'s explicit statement: "Senate D: Grayson
   failed to qualify (now running in FL-7); real primary is Vindman vs
   Nixon only." The other 13 old Senate D candidates (Atkins, Bettis,
   Cruz, Dimola, Dougherty, Gould, Jenkins, Korn, Lyles, McBride, Mujica,
   the duplicated "Dennis Gene Mr Stevens", both Weil rows) are absent
   from the Qualified+Unopposed spine — none qualified for the 2026 U.S.
   Senate ballot. Appendix E lists them individually with their old FEC ids.
6. **Senate R contracts from 14 candidates to 4** (Moody, Gleason, Rivera,
   Perry). Rubio and Rick Scott are both absent from the spine — consistent
   with the audit (Rubio resigned in 2025; Scott's seat isn't up until
   2030) — and both are also on the seven-deactivated list, so their
   removal satisfies SPEC A1 by construction (there is no fixture left to
   set `active=false` on; they are not resurrected anywhere).
7. **FL-11 R now includes Carey Baker and Joe Strada** (spec A2's explicit
   acceptance example), alongside carried-over Palomo, Razack, and
   Wilkins. Webster and Sabatini (both on the seven-deactivated list) are
   absent from the spine and do not appear.
8. **FL-19 R drops Byron Donalds** (absent from spine — consistent with him
   running for Governor per the audit, which is out of this product's
   scope entirely) while carrying over 9 other candidates unchanged.
9. **FL-16 R drops Vernon Buchanan** (absent from spine — retired per the
   audit) while carrying over Gruters, Pope, and Speir.
10. **T08 title-leak names are fixed as a side effect**, not by design
    intent of this ticket but because every candidate's `name` field is
    now taken from the spine's `doe_name` (already passed through
    `stripTitles` in `fetch_doe_roster.ts`), never from the old buggy
    fixture name. E.g. `race-fl-18-r-2026`'s incumbent is now named "Scott
    Franklin" (was "Scott Mr. Franklin"); FL-09 R's carried candidates are
    "Marcus Carter" and "Thomas E. Chalifoux" (were "Gregory Marcus Mr
    Carter", "Thomas E. Colonel Jr. Chalifoux"). Slugs are **not** changed
    (existing routes/shares stay valid) — only the display `name`.

## Judgment calls needing T26 verification

**J1 — Alan Grayson identity carryover across an office switch.**
The rebuild's default carryover rule is a strict `fec_candidate_id` match.
Grayson's old Senate filing (`S2FL00581`) and his new House filing
(`H6FL08213`) are different FEC ids, so the automatic rule would have
treated him as a brand-new, unrelated person. Per this ticket's explicit
instruction ("Alan Grayson: ... He must appear in FL-07 D in the
rebuild"), he is hand-linked by name/context, not by FEC id. Per the
seven-deactivated-slugs directive, he is written to `race-fl-07-d-2026`
with his **existing slug preserved** (`alan-mark-grayson`) but
**`active: false` and no stance/donor/vote content carried** (his old
content — "congressmanwithguts.com", financial-literacy stances — is
Senate-campaign-specific and not re-validated for a House race). This is
the only non-FEC-id identity match applied anywhere in the rebuild.
**Verify:** that this is the intended scope of "carry over" for Grayson
(content-free vs. content-carrying), and that leaving him inactive (rather
than activating him fresh in FL-07 D) matches Tommy's intent given he did
genuinely qualify there.

**J2 — Frederica S. Wilson (FL-24 D) is entirely absent from the spine.**
The pre-rebuild fixture carried her as the FL-24 D incumbent
(`H0FL17068`, `incumbent: true`). That FEC id does not appear anywhere in
the 196-row spine. She is dropped from `race-fl-24-d-2026`, which now has
no incumbent at all. This is a significant, surprising claim (a sitting
member entirely off the ballot) that this ticket cannot independently
corroborate beyond "absent from the DOE spine" — the spine is DOE ground
truth per Decision 2, so the rebuild treats this as correct, but it was
not called out in `DATA-AUDIT-2026-08-06.md`'s list of confirmed
retirements/withdrawals the way Webster/Buchanan/Donalds/Rubio/Scott
were. **Verify against DOE/Ballotpedia directly** before this is treated
as settled — this is exactly the kind of claim T26 exists to refute or
confirm.

**J3 — General rule for "identity carryover across a redistricting move."**
This ticket's instructions say carry over content "ONLY where the spine
confirms the same person ... in the SAME race." Read strictly, "same
race" could mean "same race id" (which would block the Moskowitz/
Wasserman-Schultz/Frankel fixes the audit explicitly wants). This rebuild
instead reads "same race" as "same person, confirmed by a stable
identifier (FEC candidate id), now correctly placed by the spine" — i.e.
FEC id match is trusted across a district-number change, since person-level
content (donors, votes, stances) doesn't change meaning when a district's
number changes. **Verify this interpretation is what was intended** — it
is the basis for all 10 "district moved = yes" rows in Appendix C, three
of which are incumbents (Moskowitz, Wasserman Schultz) and none of which
would have received their correct redistricted race under the stricter
reading.

**J4 — Frost's `doe_acct_num` could not be backfilled.**
Live re-fetch of the DOE extract (`dos.elections.myflorida.com`) returned
HTTP 403 from this sandbox (network egress blocked; confirmed via a direct
`curl` test before attempting the `tsx` run). `fetch_doe_roster.ts` was
extended per spec (UNO rows now included with `unopposed: true`) but could
not be re-run live. The Frost spine row was hand-added with
`doe_acct_num: null` and a `spine_note` explaining the gap; his
`fec_candidate_id` (`H2FL10259`) is corroborated by the pre-existing,
previously-verified `race-fl-10-d-2026` fixture. **Action needed:** re-run
`fetch_doe_roster.ts` from an environment with DOE network access to
backfill `doe_acct_num` and confirm no other UNO rows exist beyond Frost.

**J5 — No incumbent data available for districts 01–08, 12, 14.**
These 10 districts had zero pre-rebuild fixtures, so there is no
govtrack-derived incumbent flag to carry forward for any candidate there
(e.g. Kat Cammack FL-03 R, Kathy Castor FL-14 D, Gus Bilirakis FL-12 R,
Aaron Bean FL-04 R, John Rutherford FL-05 R — all plausibly sitting
members based on the name alone, but this ticket does not assert incumbency
without a verified source). Every candidate in these 10 districts is
written with `incumbent: false`. **This needs T02/congress-legislators
cross-referencing before activation** — do not treat district 01-08/12/14
incumbent flags as verified; they are simply unset, not confirmed-false.

**J6 — Royal Webster's carried-over stance content is known-bad.**
`DATA-AUDIT-2026-08-06.md` root cause 3.3 documents that Royal Webster's
one stance/citation was produced by the `matchRoleByName` bug — he was
wrongly attributed Daniel Webster's govtrack id and a YEA vote he never
cast. His FEC id (`H6FL11241`) matches the spine's FL-11 D row exactly, so
per this ticket's carryover rule he is legitimately carried into
`race-fl-11-d-2026` with that stance intact, bug and all. **Fixing the
content is T10's scope (ID-joined votes / govtrack matching fix), not
T03's** — flagging here so it isn't mistaken for a new finding, and so
T10/T26 know this specific candidate needs re-validation before any
activation.

**J7 — Minor-party and write-in spine rows never form a primary.**
31 of 196 spine rows are NPA/WRI/LPF/IND/FFP. None of them appear in any
rebuilt fixture, on the existing precedent that every race in this product
is `election_type='primary'` and no non-major-party race fixture existed
before this rebuild either. This includes the 5th dual-slug case,
Michaelangelo Hamilton (WRI, FL-25) — he drops from both his old races
entirely, not because he failed to qualify, but because a write-in
candidacy has no primary. **Verify this is still correct scope** if a
future ticket ever needs to represent write-in candidates.

## Validation results

- **JSON parses:** all 57 output files parse; verified programmatically
  (`JSON.parse` over every file, 0 errors).
- **Shape match for `seed_races.ts` / `seed_candidates.ts`:** every file
  has `race_id` (string), `candidates` (array), and `race` (object with
  `id, state, district, office, election_date, cycle, election_type,
  primary_party` — the exact field set `seed_races.ts` upserts). Every
  candidate has `slug`, `name`, `party`, `primary_party`, `state`,
  `district`, `office`, `race_id`, `fec_candidate_id`, `active`,
  `incumbent` — the fields `seed_candidates.ts` reads. Extra fields this
  rebuild adds (`doe_status`, `unopposed`, `incumbent_source`,
  `no_primary`, `no_primary_note`, `carryover_note`, `fec_join_note`) are
  additive and ignored by both seed scripts' explicit field whitelisting —
  confirmed by reading both scripts before writing this rebuild.
- **Global slug uniqueness:** 165 candidates, 165 unique slugs (verified
  programmatically) — the T13 dual-slug problem cannot recur because race
  membership is now spine-derived per person, not per old-fixture file.
- **Every active candidate is DOE-Qualified/Unopposed for exactly that
  race:** true by construction — active status is only ever preserved
  from an old record whose `fec_candidate_id` was matched against a spine
  row already scoped to that exact race; no fixture race can show a
  candidate the spine doesn't place there.
- **Incumbent flags unique per race:** 14 incumbents across 57 races, 0
  races with more than one (verified programmatically; the script also
  contains a defensive check that would loudly demote extras rather than
  silently pick one, in case a future re-run produces a genuine
  collision).
- **Fixtures not touched:** `scripts/seed/**`, `src/**`, `package.json`
  were not written by this ticket (verified by reading back the rebuild
  script, which only ever opens `supabase/seed/spine-2026.json` and
  `supabase/seed/candidates/*.partial.json`).
- **Not run:** the actual `npx tsx scripts/seed/seed_races.ts` /
  `seed_candidates.ts` seed against Supabase. Per this ticket's
  constraints, no script here used `SUPABASE_SERVICE_ROLE_KEY` and no
  production or database write occurred. Seeding is gated on the T26
  adversarial pass, per `AGENT-ORCHESTRATION.md`.

## Appendices

See below for the full per-candidate, per-race detail generated directly
from the rebuild script's machine-readable report (not hand-transcribed).

## Appendix A — Races removed

| Race | Reason |
|---|---|
| race-fl-10-r-2026 | No DEM or REP candidate for this district+party appears Qualified or Unopposed on the spine. FL-10 had only Maxwell Frost (DEM, Unopposed) qualify for the U.S. House seat; no Republican filed/qualified. |

## Appendix B — Races added (new fixtures, no prior file existed)

| Race | Candidate count |
|---|---|
| race-fl-01-d-2026 | 1 |
| race-fl-01-r-2026 | 3 |
| race-fl-02-d-2026 | 4 |
| race-fl-02-r-2026 | 8 |
| race-fl-03-d-2026 | 4 |
| race-fl-03-r-2026 | 1 |
| race-fl-04-d-2026 | 3 |
| race-fl-04-r-2026 | 1 |
| race-fl-05-d-2026 | 3 |
| race-fl-05-r-2026 | 2 |
| race-fl-06-d-2026 | 4 |
| race-fl-06-r-2026 | 5 |
| race-fl-07-d-2026 | 3 |
| race-fl-07-r-2026 | 4 |
| race-fl-08-d-2026 | 1 |
| race-fl-08-r-2026 | 1 |
| race-fl-12-d-2026 | 2 |
| race-fl-12-r-2026 | 1 |
| race-fl-14-d-2026 | 1 |
| race-fl-14-r-2026 | 8 |
| race-fl-24-r-2026 | 1 |
| race-fl-26-d-2026 | 1 |

## Appendix C — Candidates carried over (identity confirmed via matching FEC id, or the Grayson special case)

Columns: slug (preserved) | new race | old race (source of content) | FEC id | active | incumbent | district changed by redistricting

| Slug | New race | Old race | FEC id | Active | Incumbent | District moved |
|---|---|---|---|---|---|---|
| alan-mark-grayson | race-fl-07-d-2026 | race-fl-sen-d-2026 | H6FL08213 | false (forced, see judgment call) | false | no (office switch) |
| darren-soto | race-fl-09-d-2026 | race-fl-09-d-2026 | H6FL09179 | false | true | no (office switch) |
| gregory-marcus-mr-carter | race-fl-09-r-2026 | race-fl-09-r-2026 | H4FL09190 | false | false | no (office switch) |
| howard-steven-rance | race-fl-09-r-2026 | race-fl-09-r-2026 | H6FL10185 | false | false | no (office switch) |
| justin-story | race-fl-09-r-2026 | race-fl-09-r-2026 | H6FL09252 | false | false | no (office switch) |
| thomas-e-colonel-jr-chalifoux | race-fl-09-r-2026 | race-fl-09-r-2026 | H4FL09182 | false | false | no (office switch) |
| maxwell-alejandro-frost | race-fl-10-d-2026 | race-fl-10-d-2026 | H2FL10259 | true | true | no (office switch) |
| dan-williams | race-fl-11-d-2026 | race-fl-11-d-2026 | H6FL11233 | false | false | no (office switch) |
| royal-mr-webster | race-fl-11-d-2026 | race-fl-11-d-2026 | H6FL11241 | false | false | no (office switch) |
| ivette-palomo | race-fl-11-r-2026 | race-fl-11-r-2026 | H6FL11266 | false | false | no (office switch) |
| nizam-md-jd-razack | race-fl-11-r-2026 | race-fl-11-r-2026 | H6FL11316 | false | false | no (office switch) |
| tim-wilkins | race-fl-11-r-2026 | race-fl-11-r-2026 | H6FL11282 | false | false | no (office switch) |
| darren-mcauley | race-fl-12-d-2026 | race-fl-15-d-2026 | H6FL15192 | false | false | yes |
| john-william-liccione | race-fl-13-d-2026 | race-fl-13-d-2026 | H4FL13176 | false | false | no (office switch) |
| leela-j-gray | race-fl-13-d-2026 | race-fl-13-d-2026 | H6FL13312 | false | false | no (office switch) |
| timothy-brandt-mr-robinson | race-fl-13-d-2026 | race-fl-13-d-2026 | H6FL13254 | false | false | no (office switch) |
| anna-paulina-luna | race-fl-13-r-2026 | race-fl-13-r-2026 | H0FL13158 | true | true | no (office switch) |
| robert-people | race-fl-15-d-2026 | race-fl-15-d-2026 | H6FL15168 | false | false | no (office switch) |
| laurel-lee | race-fl-15-r-2026 | race-fl-15-r-2026 | H2FL15241 | true | true | no (office switch) |
| glenn-keith-mr-pearson | race-fl-16-d-2026 | race-fl-16-d-2026 | H6FL16109 | false | false | no (office switch) |
| jonathan-harris | race-fl-16-d-2026 | race-fl-16-d-2026 | H6FL16117 | false | false | no (office switch) |
| kelly-kirschner | race-fl-16-d-2026 | race-fl-16-d-2026 | H6FL16158 | false | false | no (office switch) |
| tamika-lyles | race-fl-16-d-2026 | race-fl-16-d-2026 | H6FL16125 | false | false | no (office switch) |
| edward-peter-dr-pope | race-fl-16-r-2026 | race-fl-16-r-2026 | H6FL16133 | false | false | no (office switch) |
| jason-edward-speir | race-fl-16-r-2026 | race-fl-16-r-2026 | H4FL16179 | false | false | no (office switch) |
| sydney-gruters | race-fl-16-r-2026 | race-fl-16-r-2026 | H6FL16141 | false | false | no (office switch) |
| allen-l-jr-spence | race-fl-17-d-2026 | race-fl-17-d-2026 | H6FL17065 | false | false | no (office switch) |
| matthew-montavon | race-fl-17-d-2026 | race-fl-17-d-2026 | H4FL17060 | false | false | no (office switch) |
| greg-steube | race-fl-17-r-2026 | race-fl-17-r-2026 | H8FL17053 | false | true | no (office switch) |
| curtis-gibson | race-fl-18-d-2026 | race-fl-18-d-2026 | H6FL18212 | false | false | no (office switch) |
| scott-mr-franklin | race-fl-18-r-2026 | race-fl-18-r-2026 | H0FL15104 | true | true | no (office switch) |
| howard-sapp | race-fl-19-d-2026 | race-fl-19-d-2026 | H6FL19111 | false | false | no (office switch) |
| victor-m-arias | race-fl-19-d-2026 | race-fl-19-d-2026 | H6FL19277 | false | false | no (office switch) |
| catalina-lauf | race-fl-19-r-2026 | race-fl-19-r-2026 | H6FL19186 | false | false | no (office switch) |
| chris-collins | race-fl-19-r-2026 | race-fl-19-r-2026 | H6FL19228 | false | false | no (office switch) |
| james-mr-oberweis | race-fl-19-r-2026 | race-fl-19-r-2026 | H6FL19129 | false | false | no (office switch) |
| jim-schwartzel | race-fl-19-r-2026 | race-fl-19-r-2026 | H6FL19137 | false | false | no (office switch) |
| john-strand | race-fl-19-r-2026 | race-fl-19-r-2026 | H6FL19194 | false | false | no (office switch) |
| linda-j-sawyer | race-fl-19-r-2026 | race-fl-19-r-2026 | H6FL19301 | false | false | no (office switch) |
| madison-cawthorn | race-fl-19-r-2026 | race-fl-19-r-2026 | H6FL19178 | false | false | no (office switch) |
| mike-pedersen | race-fl-19-r-2026 | race-fl-19-r-2026 | H6FL19145 | false | false | no (office switch) |
| ola-nesheswat-hawatmeh | race-fl-19-r-2026 | race-fl-19-r-2026 | H6FL19160 | false | false | no (office switch) |
| dale-vc-mr-holness | race-fl-20-d-2026 | race-fl-20-d-2026 | H2FL20159 | false | false | no (office switch) |
| debbie-wasserman-schultz | race-fl-20-d-2026 | race-fl-25-d-2026 | H4FL20023 | true | true | yes |
| elijah-manley | race-fl-20-d-2026 | race-fl-20-d-2026 | H6FL20077 | false | false | no (office switch) |
| luther-mr-campbell | race-fl-20-d-2026 | race-fl-20-d-2026 | H4FL20098 | false | false | no (office switch) |
| sheila-cherfilus-mccormick | race-fl-20-d-2026 | race-fl-20-d-2026 | H8FL20032 | false | false | no (office switch) |
| lateresa-a-jones | race-fl-20-r-2026 | race-fl-22-r-2026 | H6FL20127 | false | false | yes |
| rodenay-mr-joseph | race-fl-20-r-2026 | race-fl-20-r-2026 | H6FL20069 | false | false | no (office switch) |
| bernard-taylor | race-fl-21-d-2026 | race-fl-21-d-2026 | H6FL21034 | false | false | no (office switch) |
| james-martin | race-fl-21-d-2026 | race-fl-21-d-2026 | H6FL21075 | false | false | no (office switch) |
| brian-mast | race-fl-21-r-2026 | race-fl-21-r-2026 | H6FL18097 | false | true | no (office switch) |
| pia-dandiya | race-fl-22-d-2026 | race-fl-21-d-2026 | H6FL21059 | false | false | yes |
| david-burck | race-fl-22-r-2026 | race-fl-22-r-2026 | H6FL22156 | false | false | no (office switch) |
| michael-carbonara | race-fl-22-r-2026 | race-fl-22-r-2026 | H6FL25035 | false | false | no (office switch) |
| lois-j-frankel | race-fl-23-d-2026 | race-fl-23-d-2026 | H2FL14053 | true | true | no (office switch) |
| victoria-jane-boker-doyle | race-fl-23-d-2026 | race-fl-23-d-2026 | H6FL22107 | false | false | no (office switch) |
| deborah-adeimy | race-fl-23-r-2026 | race-fl-22-r-2026 | H2FL21132 | false | false | yes |
| paola-dr-branda | race-fl-23-r-2026 | race-fl-22-r-2026 | H6FL22172 | false | false | yes |
| rudolph-dr-moise | race-fl-24-d-2026 | race-fl-20-d-2026 | H0FL17118 | false | false | yes |
| jared-moskowitz | race-fl-25-d-2026 | race-fl-23-d-2026 | H2FL22171 | true | true | yes |
| oliver-adams-larkin | race-fl-25-d-2026 | race-fl-23-d-2026 | H6FL23154 | false | false | yes |
| daniel-john-franzese | race-fl-25-r-2026 | race-fl-25-r-2026 | H2FL21108 | false | false | no (office switch) |
| george-r-moraitis | race-fl-25-r-2026 | race-fl-25-r-2026 | H6FL23147 | false | false | no (office switch) |
| joe-kaufman | race-fl-25-r-2026 | race-fl-23-r-2026 | H2FL20043 | false | false | yes |
| raven-harrison | race-fl-25-r-2026 | race-fl-25-r-2026 | H6FL23139 | false | false | no (office switch) |
| scott-m-singer | race-fl-25-r-2026 | race-fl-25-r-2026 | H6FL23188 | false | false | no (office switch) |
| mario-diaz-balart | race-fl-26-r-2026 | race-fl-26-r-2026 | H2FL25018 | true | true | no (office switch) |
| eliott-rodriguez | race-fl-27-d-2026 | race-fl-27-d-2026 | H6FL27098 | false | false | no (office switch) |
| robin-peguero | race-fl-27-d-2026 | race-fl-27-d-2026 | H6FL27072 | false | false | no (office switch) |
| maria-elvira-salazar | race-fl-27-r-2026 | race-fl-27-r-2026 | H8FL27185 | true | true | no (office switch) |
| vincent-michael-arias | race-fl-27-r-2026 | race-fl-27-r-2026 | H4FL27028 | false | false | no (office switch) |
| phil-ehr | race-fl-28-d-2026 | race-fl-28-d-2026 | H4FL28042 | false | false | no (office switch) |
| carlos-gimenez | race-fl-28-r-2026 | race-fl-28-r-2026 | H0FL26036 | true | true | no (office switch) |
| alexander-vindman | race-fl-sen-d-2026 | race-fl-sen-d-2026 | S6FL00855 | true | false | no (office switch) |
| angela-nixon | race-fl-sen-d-2026 | race-fl-sen-d-2026 | S6FL00830 | true | false | no (office switch) |
| ashley-moody | race-fl-sen-r-2026 | race-fl-sen-r-2026 | S6FL00640 | true | true | no (office switch) |
| christopher-gleason | race-fl-sen-r-2026 | race-fl-sen-r-2026 | S6FL00848 | false | false | no (office switch) |
| ernest-ernie-john-rev-dr-rivera | race-fl-sen-r-2026 | race-fl-sen-r-2026 | S6FL00897 | false | false | no (office switch) |

## Appendix D — New candidates (minimal spine-only records, active=false, no authored content)

| Slug | Race | FEC id | Note |
|---|---|---|---|
| gay-valimont | race-fl-01-d-2026 | H4FL01197 |  |
| douglas-chico | race-fl-01-r-2026 | H6FL01515 |  |
| jimmy-patronis | race-fl-01-r-2026 | H6FL01390 |  |
| john-frankman | race-fl-01-r-2026 | H6FL01523 |  |
| amanda-marie-green | race-fl-02-d-2026 | H6FL02299 |  |
| brice-barnes | race-fl-02-d-2026 | H6FL02398 |  |
| nicholas-zateslo | race-fl-02-d-2026 | H6FL02281 |  |
| yen-bailey | race-fl-02-d-2026 | H4FL02138 |  |
| audie-rowell | race-fl-02-r-2026 | H6FL02349 |  |
| austin-rogers | race-fl-02-r-2026 | H6FL02331 |  |
| evan-power | race-fl-02-r-2026 | H6FL02315 |  |
| jim-norton | race-fl-02-r-2026 | H6FL02356 |  |
| keith-gross | race-fl-02-r-2026 | H4FL01247 |  |
| lee-jones | race-fl-02-r-2026 | H6FL02380 |  |
| luke-murphy | race-fl-02-r-2026 | H6FL02364 |  |
| nick-lewis | race-fl-02-r-2026 | H6FL02323 |  |
| george-hubac | race-fl-03-d-2026 | H6FL03131 |  |
| seth-harp | race-fl-03-d-2026 | H6FL03099 |  |
| tom-wells | race-fl-03-d-2026 | H8FL03020 |  |
| troy-albers | race-fl-03-d-2026 | H6FL03115 |  |
| kat-cammack | race-fl-03-r-2026 | H0FL03175 |  |
| brit-robinson | race-fl-04-d-2026 | H6FL04204 |  |
| lashonda-lj-holloway | race-fl-04-d-2026 | H6FL05193 |  |
| michael-kirwan | race-fl-04-d-2026 | H6FL04220 |  |
| aaron-bean | race-fl-04-r-2026 | H2FL04211 |  |
| alex-hazen | race-fl-05-d-2026 | H6FL05284 |  |
| mark-heggestad | race-fl-05-d-2026 | H6FL05235 |  |
| rachel-grage | race-fl-05-d-2026 | H6FL05250 |  |
| john-h-rutherford | race-fl-05-r-2026 | H6FL04105 |  |
| mark-kaye | race-fl-05-r-2026 | H6FL05201 |  |
| eric-yonce | race-fl-06-d-2026 | H6FL06340 |  |
| robert-david-cooper | race-fl-06-d-2026 | H6FL06381 |  |
| ronnie-ron-murchinson-rivera | race-fl-06-d-2026 | H6FL06332 |  |
| steve-morgan | race-fl-06-d-2026 | H6FL06407 |  |
| aaron-baker | race-fl-06-r-2026 | H6FL06324 |  |
| charles-gambaro | race-fl-06-r-2026 | H6FL06357 |  |
| dan-bilzerian | race-fl-06-r-2026 | H6FL06415 |  |
| manuel-p-asensio | race-fl-06-r-2026 | H2FL03197 |  |
| randy-fine | race-fl-06-r-2026 | H6FL06258 |  |
| bale-dalton | race-fl-07-d-2026 | H6FL07215 |  |
| marialana-kinter | race-fl-07-d-2026 | H6FL07165 |  |
| cory-lee-mills | race-fl-07-r-2026 | H2FL07156 |  |
| michael-don-johnson | race-fl-07-r-2026 | H4FL07152 |  |
| ryan-elijah | race-fl-07-r-2026 | H6FL07231 |  |
| sarah-ulrich | race-fl-07-r-2026 | H6FL07223 |  |
| jennifer-jenkins | race-fl-08-d-2026 | H6FL06399 |  |
| mike-haridopolos | race-fl-08-r-2026 | H4FL08168 |  |
| ben-butler | race-fl-09-r-2026 | H6FL09278 |  |
| dan-green | race-fl-09-r-2026 | H6FL09294 |  |
| jorge-martinez | race-fl-09-r-2026 | H6FL09286 |  |
| james-pericola | race-fl-11-d-2026 | H6FL11357 |  |
| carey-baker | race-fl-11-r-2026 | H6FL11340 |  |
| joe-strada | race-fl-11-r-2026 | H6FL11332 |  |
| kimberly-overman | race-fl-12-d-2026 | H6FL15200 |  |
| gus-michael-bilirakis | race-fl-12-r-2026 | H6FL09070 |  |
| kathy-castor | race-fl-14-d-2026 | H6FL11126 |  |
| bea-valenti | race-fl-14-r-2026 | H6FL14211 |  |
| ergin-batman-tek | race-fl-14-r-2026 | H6FL14161 |  |
| gavriel-e-soriano | race-fl-14-r-2026 | H2FL11125 |  |
| john-peters | race-fl-14-r-2026 | H4FL14141 |  |
| kevin-m-steele | race-fl-14-r-2026 | H6FL14229 |  |
| michael-marcel | race-fl-14-r-2026 | H6FL14195 |  |
| mike-beltran | race-fl-14-r-2026 | H6FL14237 |  |
| robert-rocky-rochford | race-fl-14-r-2026 | H4FL14117 |  |
| christopher-irizarry | race-fl-15-d-2026 | H6FL12199 |  |
| jan-schneider | race-fl-16-d-2026 | H2FL13139 |  |
| robert-m-neeld | race-fl-19-d-2026 | H4FL14091 |  |
| greg-tex-bukowski | race-fl-19-r-2026 | H6FL19335 |  |
| brent-andersen | race-fl-20-r-2026 | H6FL20143 |  |
| carla-spalding | race-fl-20-r-2026 | (null) | ambiguous: 2 FEC candidates matched district/office/cycle=2026 for last name "Spalding": H0FL23090 (SPALDING, CARLA A); H6FL18121 (SPALDING, CARLA ARLENE) |
| kaysia-earley | race-fl-22-d-2026 | H6FL22222 |  |
| belinda-keiser | race-fl-22-r-2026 | H6FL22206 |  |
| casey-askar | race-fl-22-r-2026 | H6FL22248 |  |
| michael-thompson | race-fl-22-r-2026 | H6FL22180 |  |
| richard-evans | race-fl-22-r-2026 | (null) | no FEC candidate found for "Richard Evans" in H/22/cycle=2026 (20 FEC candidates searched in that race) |
| terri-hasdorff | race-fl-22-r-2026 | H6FL22214 |  |
| mark-piper | race-fl-23-d-2026 | H4FL23134 |  |
| jean-monestime | race-fl-24-d-2026 | H6FL24079 |  |
| kendrick-meek | race-fl-24-d-2026 | H6FL24111 |  |
| marshall-l-davis | race-fl-24-d-2026 | H6FL24129 |  |
| oliver-g-gilbert | race-fl-24-d-2026 | H6FL24095 |  |
| roderick-vereen | race-fl-24-d-2026 | (null) | ambiguous: 2 FEC candidates matched district/office/cycle=2026 for last name "Vereen": H0FL17092 (VEREEN, RODERICK D); H6FL24103 (VEREEN, RODERICK DARRELL) |
| shevrin-shev-jones | race-fl-24-d-2026 | H6FL24087 |  |
| te-mayonna-brown | race-fl-24-r-2026 | H6FL14203 |  |
| nicole-locklin | race-fl-26-d-2026 | H6FL26058 |  |
| neelam-taneja-perry | race-fl-sen-r-2026 | (null) | ambiguous: 3 FEC candidates matched district/office/cycle=2026 for last name "Perry": S6FL00772 (PERRY, NEELAM TANEJA DR); S6FL00764 (PERRY, NEELAM TANEJA DR); S6FL00780 (PERRY, NEELAM TANEJA DR) |

## Appendix E — Candidates dropped: absent from the Qualified+Unopposed spine

These FEC ids/slugs existed in the pre-rebuild fixtures but do not appear anywhere in the 165 DEM/REP spine rows used to build races. They are not carried into any new fixture (no minimal record is created for a dropped candidate — they simply do not appear).

| Slug | Old race | Old file | FEC id | Was active | Was incumbent |
|---|---|---|---|---|---|
| jorge-antonio-malavet | race-fl-09-r-2026 | race-fl-09-r-2026.partial.json | H6FL09260 | false | false |
| angela-marie-walls-windhauser | race-fl-10-r-2026 | race-fl-10-r-2026.partial.json | H6FL10193 | false | false |
| stuart-ross-farber | race-fl-10-r-2026 | race-fl-10-r-2026.partial.json | H6FL10177 | false | false |
| vibert-dr-white | race-fl-10-r-2026 | race-fl-10-r-2026.partial.json | H4FL10123 | false | false |
| willie-montague | race-fl-10-r-2026 | race-fl-10-r-2026.partial.json | H0FL10113 | false | false |
| barbara-barbie-harden-hall | race-fl-11-d-2026 | race-fl-11-d-2026.partial.json | H4FL11105 | false | false |
| shawn-stefan-bettis | race-fl-11-d-2026 | race-fl-11-d-2026.partial.json | H6FL11274 | false | false |
| antonette-harmon | race-fl-11-r-2026 | race-fl-11-r-2026.partial.json | H6FL11225 | false | false |
| michael-wilnau | race-fl-11-r-2026 | race-fl-11-r-2026.partial.json | H6FL07181 | false | false |
| steve-farley | race-fl-11-r-2026 | race-fl-11-r-2026.partial.json | H6FL11308 | false | false |
| earle-ford | race-fl-13-d-2026 | race-fl-13-d-2026.partial.json | H6FL13239 | false | false |
| fatima-ezahra-aguerjout | race-fl-13-d-2026 | race-fl-13-d-2026.partial.json | H6FL13288 | false | false |
| jeffrey-moore | race-fl-13-d-2026 | race-fl-13-d-2026.partial.json | H6FL13221 | false | false |
| john-t-fay | race-fl-13-d-2026 | race-fl-13-d-2026.partial.json | H6FL13296 | false | false |
| karla-kemp | race-fl-13-d-2026 | race-fl-13-d-2026.partial.json | H6FL13262 | false | false |
| reginald-paros | race-fl-13-d-2026 | race-fl-13-d-2026.partial.json | H6FL13247 | false | false |
| susan-rochelle-leff | race-fl-13-d-2026 | race-fl-13-d-2026.partial.json | H8FL13151 | false | false |
| amaro-lionheart | race-fl-13-r-2026 | race-fl-13-r-2026.partial.json | H6FL14138 | false | false |
| courtney-ms-offutt | race-fl-13-r-2026 | race-fl-13-r-2026.partial.json | H6FL13320 | false | false |
| jose-engell | race-fl-15-d-2026 | race-fl-15-d-2026.partial.json | H6FL15184 | false | false |
| steven-douglas-ii-champion | race-fl-15-r-2026 | race-fl-15-r-2026.partial.json | H6FL15226 | false | false |
| jan-schneider | race-fl-16-d-2026 | race-fl-16-d-2026.partial.json | H4FL16161 | false | false |
| tiffanie-shavon-luong | race-fl-18-d-2026 | race-fl-18-d-2026.partial.json | H6FL18220 | false | false |
| walter-l-dr-campbell | race-fl-18-r-2026 | race-fl-18-r-2026.partial.json | H0FL18231 | false | false |
| jared-martin-kane | race-fl-19-d-2026 | race-fl-19-d-2026.partial.json | H6FL19202 | false | false |
| dylan-modarelli | race-fl-19-r-2026 | race-fl-19-r-2026.partial.json | H6FL19152 | false | false |
| john-robert-fratto | race-fl-19-r-2026 | race-fl-19-r-2026.partial.json | H4FL26095 | false | false |
| louis-shenker | race-fl-19-r-2026 | race-fl-19-r-2026.partial.json | H6FL19236 | false | false |
| richard-stephen-iii-youschak | race-fl-19-r-2026 | race-fl-19-r-2026.partial.json | H6FL19285 | false | false |
| stephen-w-elliott | race-fl-19-r-2026 | race-fl-19-r-2026.partial.json | H6FL19210 | false | false |
| maisha-williams | race-fl-20-d-2026 | race-fl-20-d-2026.partial.json | H6FL20135 | false | false |
| mark-a-mr-douglas | race-fl-20-d-2026 | race-fl-20-d-2026.partial.json | H6FL20085 | false | false |
| sendra-dorce | race-fl-20-r-2026 | race-fl-20-r-2026.partial.json | H6FL23170 | false | false |
| edward-f-mr-oconnor | race-fl-21-d-2026 | race-fl-21-d-2026.partial.json | H6FL21091 | false | false |
| elizabeth-pandich | race-fl-21-d-2026 | race-fl-21-d-2026.partial.json | H6FL21042 | false | false |
| ian-scott-blake | race-fl-22-d-2026 | race-fl-22-d-2026.partial.json | H6FL22115 | false | false |
| anna-medvedeva | race-fl-22-r-2026 | race-fl-22-r-2026.partial.json | H6FL22099 | false | false |
| antonio-srado | race-fl-22-r-2026 | race-fl-22-r-2026.partial.json | H6FL22131 | false | false |
| daniel-john-franzese | race-fl-22-r-2026 | race-fl-22-r-2026.partial.json | H6FL22149 | false | false |
| herbert-dr-od-wertheim | race-fl-22-r-2026 | race-fl-22-r-2026.partial.json | H6FL22164 | false | false |
| jayden-antropov | race-fl-22-r-2026 | race-fl-22-r-2026.partial.json | H4FL22128 | false | false |
| steven-crowley | race-fl-22-r-2026 | race-fl-22-r-2026.partial.json | H6FL22123 | false | false |
| darlene-cerezo-swaffar | race-fl-23-r-2026 | race-fl-23-r-2026.partial.json | H0FL22100 | false | false |
| jared-gurfein | race-fl-23-r-2026 | race-fl-23-r-2026.partial.json | H6FL23162 | false | false |
| michaelangelo-collins-hamilton | race-fl-23-r-2026 | race-fl-23-r-2026.partial.json | H6FL23105 | false | false |
| rafael-arturo-mr-ortiz | race-fl-23-r-2026 | race-fl-23-r-2026.partial.json | H4FL23092 | false | false |
| christine-alexandria-sanon-jules | race-fl-24-d-2026 | race-fl-24-d-2026.partial.json | H2FL24037 | false | false |
| frederica-s-wilson | race-fl-24-d-2026 | race-fl-24-d-2026.partial.json | H0FL17068 | false | true |
| claudia-villatoro | race-fl-25-r-2026 | race-fl-25-r-2026.partial.json | H6FL25043 | false | false |
| alexander-fornino | race-fl-27-d-2026 | race-fl-27-d-2026.partial.json | H6FL27064 | false | false |
| kristen-rosen-gonzalez | race-fl-27-d-2026 | race-fl-27-d-2026.partial.json | H8FL27029 | false | false |
| lev-parnas | race-fl-27-d-2026 | race-fl-27-d-2026.partial.json | H6FL27106 | false | false |
| michael-davey | race-fl-27-d-2026 | race-fl-27-d-2026.partial.json | H4FL27036 | false | false |
| richard-lamondin | race-fl-27-d-2026 | race-fl-27-d-2026.partial.json | H6FL27056 | false | false |
| hector-daniel-mujica | race-fl-28-d-2026 | race-fl-28-d-2026.partial.json | H6FL28047 | false | false |
| james-f-mr-henry | race-fl-28-d-2026 | race-fl-28-d-2026.partial.json | H6FL28013 | false | false |
| thomas-anthony-mr-jr-campione | race-fl-28-d-2026 | race-fl-28-d-2026.partial.json | H6FL28039 | false | false |
| royland-lara | race-fl-28-r-2026 | race-fl-28-r-2026.partial.json | H4FL28026 | false | false |
| bernard-korn | race-fl-sen-d-2026 | race-fl-sen-d-2026.partial.json | S0FL00635 | false | false |
| charles-aka-alex-a-gould | race-fl-sen-d-2026 | race-fl-sen-d-2026.partial.json | S6FL00699 | false | false |
| dennis-gene-mr-stevens | race-fl-sen-d-2026 | race-fl-sen-d-2026.partial.json | S6FL00707 | false | false |
| evelyn-jane-marie-dr-mcbride | race-fl-sen-d-2026 | race-fl-sen-d-2026.partial.json | S6FL00665 | false | false |
| frank-dimola | race-fl-sen-d-2026 | race-fl-sen-d-2026.partial.json | S6FL00731 | false | false |
| hector-daniel-mujica | race-fl-sen-d-2026 | race-fl-sen-d-2026.partial.json | S6FL00806 | false | false |
| jennifer-jenkins | race-fl-sen-d-2026 | race-fl-sen-d-2026.partial.json | S6FL00798 | false | false |
| joey-mendoza-atkins | race-fl-sen-d-2026 | race-fl-sen-d-2026.partial.json | S6FL00749 | false | false |
| joshua-joseph-weil | race-fl-sen-d-2026 | race-fl-sen-d-2026.partial.json | S6FL00756 | false | false |
| joshua-weil | race-fl-sen-d-2026 | race-fl-sen-d-2026.partial.json | S2FL00466 | false | false |
| kael-dougherty | race-fl-sen-d-2026 | race-fl-sen-d-2026.partial.json | S6FL00566 | false | false |
| paul-ron-cruz | race-fl-sen-d-2026 | race-fl-sen-d-2026.partial.json | S6FL00723 | false | false |
| shawn-stefan-bettis | race-fl-sen-d-2026 | race-fl-sen-d-2026.partial.json | S6FL00889 | false | false |
| tamika-ms-lyles | race-fl-sen-d-2026 | race-fl-sen-d-2026.partial.json | S6FL00673 | false | false |
| alix-christopher-mr-jr-toulme | race-fl-sen-r-2026 | race-fl-sen-r-2026.partial.json | S4FL00769 | false | false |
| angela-marie-walls-windhauser | race-fl-sen-r-2026 | race-fl-sen-r-2026.partial.json | S6FL00442 | false | false |
| angie-windhauser | race-fl-sen-r-2026 | race-fl-sen-r-2026.partial.json | S6FL00814 | false | false |
| ashley-jean-baptiste | race-fl-sen-r-2026 | race-fl-sen-r-2026.partial.json | S8FL00323 | false | false |
| jake-lang | race-fl-sen-r-2026 | race-fl-sen-r-2026.partial.json | S6FL00657 | false | false |
| josue-economist-larose | race-fl-sen-r-2026 | race-fl-sen-r-2026.partial.json | S6FL00624 | false | false |
| michaelangelo-collins-hamilton | race-fl-sen-r-2026 | race-fl-sen-r-2026.partial.json | S6FL00632 | false | false |
| neelam-dr-taneja-perry | race-fl-sen-r-2026 | race-fl-sen-r-2026.partial.json | S6FL00871 | false | false |
| tyrone-dawayne-bishop-brown | race-fl-sen-r-2026 | race-fl-sen-r-2026.partial.json | S8FL00307 | false | false |

## Appendix F — Seven confirmed-wrong candidates (SPEC A1 / DECISIONS-2026-08-06.md #1): disposition

| Slug | Old race | Disposition |
|---|---|---|
| anthony-sabatini | race-fl-11-r-2026 | Absent from spine (not Qualified/Unopposed federally) — does not appear in any rebuilt fixture. |
| daniel-webster | race-fl-11-r-2026 | Absent from spine (not Qualified/Unopposed federally) — does not appear in any rebuilt fixture. |
| vernon-buchanan | race-fl-16-r-2026 | Absent from spine (not Qualified/Unopposed federally) — does not appear in any rebuilt fixture. |
| byron-donalds | race-fl-19-r-2026 | Absent from spine (not Qualified/Unopposed federally) — does not appear in any rebuilt fixture. |
| marco-rubio | race-fl-sen-r-2026 | Absent from spine (not Qualified/Unopposed federally) — does not appear in any rebuilt fixture. |
| rick-sen-scott | race-fl-sen-r-2026 | Absent from spine (not Qualified/Unopposed federally) — does not appear in any rebuilt fixture. |
| alan-mark-grayson | race-fl-sen-d-2026 | Qualified in FL-07 D under a different FEC filing (H6FL08213). Appears in race-fl-07-d-2026 as a minimal, active=false record — see judgment call G1. |

## Appendix G — Dual-race slug resolutions (T13)

| Slug | Old races | Resolved to | Dropped from |
|---|---|---|---|
| angela-marie-walls-windhauser | race-fl-10-r-2026, race-fl-sen-r-2026 | (none — absent from spine) | race-fl-10-r-2026 (race-fl-10-r-2026.partial.json); race-fl-sen-r-2026 (race-fl-sen-r-2026.partial.json) |
| shawn-stefan-bettis | race-fl-11-d-2026, race-fl-sen-d-2026 | (none — absent from spine) | race-fl-11-d-2026 (race-fl-11-d-2026.partial.json); race-fl-sen-d-2026 (race-fl-sen-d-2026.partial.json) |
| daniel-john-franzese | race-fl-22-r-2026, race-fl-25-r-2026 | race-fl-25-r-2026 | race-fl-22-r-2026 (race-fl-22-r-2026.partial.json) |
| michaelangelo-collins-hamilton | race-fl-23-r-2026, race-fl-sen-r-2026 | (none — absent from spine) | race-fl-23-r-2026 (race-fl-23-r-2026.partial.json); race-fl-sen-r-2026 (race-fl-sen-r-2026.partial.json) |
| hector-daniel-mujica | race-fl-28-d-2026, race-fl-sen-d-2026 | (none — absent from spine) | race-fl-28-d-2026 (race-fl-28-d-2026.partial.json); race-fl-sen-d-2026 (race-fl-sen-d-2026.partial.json) |

## Appendix H — Byte-identical duplicate rows removed (T13)

| File | FEC id | Name |
|---|---|---|
| race-fl-13-d-2026.partial.json | H6FL13288 | Fatima Ezahra Aguerjout |
| race-fl-15-d-2026.partial.json | H6FL15184 | Jose Engell |
| race-fl-18-r-2026.partial.json | H0FL18231 | Walter L Dr. Campbell |
| race-fl-18-r-2026.partial.json | H0FL18231 | Walter L Dr. Campbell |
| race-fl-sen-d-2026.partial.json | S6FL00707 | Dennis Gene Mr Stevens |

---

## Post-verification record (T26, 2026-08-06)

Two blind adversarial verifiers (opus tier) attacked this rebuild against primary sources only.

**Roster verifier — live DOE pull, all 57 races checked:**
- CONFIRMED: 1:1 reconciliation of all 165 candidates / 57 races against the live DOE extract (elecID 20261103-GEN). Zero unqualified candidates present, zero qualified D/R candidates missing, zero district/party mismatches. Grayson FL-07 (H6FL08213), Wilson absent (DNQ + retirement), Frost FL-10 D unopposed, FL-11 R five-way field, both Senate primaries: all independently confirmed via news/FEC sources.
- REFUTED (fixed 2026-08-06): nine sitting members in districts 01, 03, 04, 05, 06, 07, 08, 12, 14 carried `incumbent: false` (the rebuild only derived flags where prior fixtures existed, i.e. districts 09+). Fixed: Patronis, Cammack, Bean, Rutherford, Fine, Mills, Haridopolos, Bilirakis, Castor now `incumbent: true` with `incumbent_source` citing the verification. 23 incumbents total, uniqueness re-validated.
- Judgment calls J1 (Grayson carryover) and J2 (Wilson absence) are therefore CONFIRMED. J3 semantics ("sitting member running in this primary" for renumbered districts: Frankel, Moskowitz, Wasserman Schultz) noted by the verifier as interpretation-dependent; retained deliberately — the flag means "sitting member on this primary ballot".

**Geometry verifier — official shapefile + block-equivalency file:**
- CONFIRMED: committed GeoJSON is geometrically identical to the official EOGPCRP2026 plan (0.00% symmetric difference on all 28 districts); 23/23 geocoded landmarks resolve to the officially assigned district, including five that changed districts under the new map; EOGPCRP2026 is in force for the Aug 18 primary (no court alteration as of 2026-08-06).
- REFUTED (fix in progress): the ZIP crosswalk's 2% area noise floor dropped populated slivers (33955, 32826, 33849 wrongly single-district), and area-based shares invert 33142's resident-majority ordering. The crosswalk is being rebuilt population-weighted from the official block-equivalency + Census block data; acceptance tests lock the verifier's population figures.
