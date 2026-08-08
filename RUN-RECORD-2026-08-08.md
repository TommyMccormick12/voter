# Discovery + match-gate run — process record, 2026-08-08

Companion to `RUN-RECORD-2026-08-07.md`. Covers GitHub issues #36, #37,
#38, #39–#44, the triage of epic #8 with its children #12–#16, and the
verification pass and follow-ups that ran afterwards (PR #51).
Primary is **2026-08-18** (10 days out).

> This file was first committed mid-run and was stale within the hour —
> the exact failure #17 exists to prevent. Completed 2026-08-08 evening
> after the verification pass, the second search round, and PR #51.

## Outcome

| | Start of day | End of day |
|---|---|---|
| Active candidates | 93 | **100** |
| Live stances | 395 | **441** |
| Unsourced stances | 0 | **0** |
| Races with the match flow open | 10 of 57 | **25 of 57** |
| Races with ≥1 active candidate | 57 of 57 | 57 of 57 |
| Races still honestly "Curating" (0 active) | 0 | **0** |
| Races fully covered (profiled == ballot) | — | 35 of 57 |

Match open went 10 → 25 by two independent routes: **+5** from sourcing a
third candidate into five one-short races, and **+10** from correcting a
CTA rule that had locked fully-covered two-candidate ballots out forever.

## Verification standing — read this before trusting the table below

**The five candidates activated today did NOT pass the Decision 12
adversarial gate.** Tommy waived per-candidate review for this batch on
the tickets themselves. What they did pass:

- **Mechanical gates, unmodified** — ≥3 stances, a `Qualified` DOE-spine
  match by FEC id for *exactly* that race, a fresh `verified_at`.
  `--include-unreviewed` was never used.
- **Source-read verification by the authoring agent** — every stance
  traces to a first-party page or questionnaire answer that was fetched
  and read in full during this session, and every stance carries a
  `source_url` that resolves.

They did **not** pass an independent blind refutation-first verifier at
the time of activation. **That pass was run later the same day, at
Tommy's request, and it refuted five of the 34.** See the section below.
Everything shipped after that pass was checked against source at
authoring time.

- **CONFIRMED** means checked against the live site, the database, or a
  re-read of the source.
- **PLAUSIBLE** means authored from a source that was read, mechanically
  gated, and not independently refuted.

## Per-candidate outcomes — every candidate touched, exactly once

### Activated and live (5) — all PLAUSIBLE

| Candidate | Race | Stances | Source read | State |
|---|---|---|---|---|
| Jim Norton | FL-02 R | 6 | `nortonforflorida.com` — 5 dedicated issue pages | live |
| Troy Albers | FL-03 D | 7 | `albersforcongress.com/issues` | live |
| Aaron Baker | FL-06 R | 10 | `aaron4fl6.com/policy` | live |
| Alan Grayson | FL-07 D | 7 | News Collaborative of Central Florida candidate Q&A | live |
| Mark Piper | FL-23 D | 4 | `makingsure.net` | live |

### Refused (1)

| Candidate | Race | Reason |
|---|---|---|
| Robert M. Neeld | FL-19 D | No 2026 campaign site, no published platform, no active social media, no 2026 news coverage. Sparker's Soapbox had independently reached the same conclusion on 2026-07-08. His only source is a 2016 Naples Daily News piece about a run in the then-numbered FL-14 — wrong contest, wrong cycle. Recorded on issue #40, which is closed as refused. |

### Searched, no first-party positions found (2)

| Candidate | Race | What was found |
|---|---|---|
| Evan Power | FL-02 R | Chairs the Republican Party of Florida; extensive press coverage of his candidacy, but no campaign issues page located. Press paraphrase is not a first-party position statement. |
| Tom Wells | FL-03 D | Listed in the FL-03 D voter guide and on Ballotpedia; biography only, no positions surfaced in the searches run. |

### Capped in the first round, then searched (7)

The first round stopped once a race had one success — one activation was
all any of them needed to open the match flow. Tommy then asked for the
rest to be searched, so none of these remain unexamined. **Two were
sourced and are live; five are refused with reasons.**

| Candidate | Race | Note |
|---|---|---|
| Luke Murphy | FL-02 R | **LIVE, 6 stances.** `lukemurphyforcongress.com/issues` — seven substantive issue areas. |
| Charles Gambaro | FL-06 R | **LIVE, 5 stances.** `voteforgambaro.com/issues`. |
| Evan Power | FL-02 R | Refused. `evanpowerforcongress.com` and `powerforcongress.com` both resolve but serve no content. |
| Nick Lewis | FL-02 R | Refused. `nicklewisforcongress.com` resolves but serves no content. |
| Audie Rowell | FL-02 R | Refused. No campaign site located. One forum quote only. |
| Lee Jones | FL-02 R | Refused. No campaign site located. |
| Manuel P. Asensio | FL-06 R | Refused. `asensio4congress.com` is a single grievance thread about federal judicial misconduct and January 6, not a multi-issue platform. Cannot reach three stances across distinct issues. |
| Jan Schneider | FL-16 D | Inactive; touched only by the money re-pull, see below. |

Tom Wells (FL-03 D), listed above as "no positions surfaced", was
re-searched and is now a firm refusal: `tomwellsforcongress.com` has a
full issues page, but it is his **2020** platform. It opens *"It early
August 2020. The United States is the epicenter of the global
pandemic"* and discusses *"Jan 20 when a new president"* takes office.
The only year markers on the page are 2020 and 2021, and the incumbent
he would face is never mentioned.

**A WFSU Capital Tiger Bay Club forum writeup** gives one direct quote
each for Rowell, Power and Murphy — real, dated, attributable, and
nowhere near the three-stance gate. One quote is not a platform.

**`murphyforflorida.com` is Patrick Murphy**, a former Democratic
congressman, not Luke Murphy the FL-02 Republican. Checked before use.
Same wrong-person trap that once gave FL-11 Daniel Webster the bio of
the 1782–1852 statesman.

**Final coverage: FL-02 R is 4 of 8, FL-06 R is 4 of 5, FL-03 D is 3 of
4.** The remaining uncovered candidates are refused with recorded
reasons, not pending.

## The verification pass — 5 of 34 refuted, all of them live at the time

Run after the fact, refutation-first, against a fresh fetch of every
source. **29 held. Five did not.** This is why the pass exists: all five
had passed the mechanical gates and looked fine in review.

**1. A fabricated legislative credential.** Grayson's healthcare stance
read *"Authored Medicare for All legislation **and child Medicare
extension** while in Congress."* His questionnaire makes exactly three
authorship claims — Medicare for All, the $50,000 tax-threshold bill,
and the flood insurance extension. Extending Medicare to every child
appears only as a proposal: *"Medicare should cover everyone until 18."*
The second half of that credential was invented, on a real person's card.

**2. Three notes stated the candidate's own claims as our verification.**
`track_record_note` exists to surface stated-versus-actual gaps from an
**independent** record. Feeding it a candidate's boast about himself
inverts the feature — the card reads as though we checked. All three now
attribute: *"Says he wrote..."*. Norton's note likewise asserted his
tenure *"demonstrates commitment to local education leadership"*, which
is advocacy rather than a record, drawn from a page the stance did not
cite.

**3. Four stances cited a page that does not contain the claim.**
`synthesize_stances.ts` stamped **one** `website` value onto **every**
stance. Correct for a single-source candidate; silently wrong the moment
one is authored from two. Albers was authored from his issues page and
his voter-guide answers; three guide-only claims cited his campaign site.
Baker's housing stance mixed a HUD position from his policy page with
Florida homestead-exemption numbers that live only in the guide, answered
under a question the guide *itself* labels "(State Issue)" — state policy
on a federal scorecard.

A scan of all 441 live stances afterwards found **zero** remaining
instances of the two detectable classes.

**Lesson: the mechanical gates check that a stance exists and is
sourced. They cannot check that the source says what the stance claims.
Only re-reading the source does that.**

## Two source traps — the most transferable findings of the day

### A first-party source can be the wrong contest

**Alan Grayson's `electgrayson.com/policies-2/` states real positions
for the wrong office.** The page opens *"We can do this in the State
Senate"* — left over from his state-senate bid, while the site's home
page had been updated for the congressional run. Ingesting it would have
put state-legislative promises on a congressional scorecard, sourced to
the candidate's own domain, and nothing in the pipeline would have
caught it.

He was sourced from his FL-07 questionnaire answers instead.

**`graysonforcongress.com` is a lapsed domain now serving online-casino
SEO spam** under his name. It is not a campaign source and must never be
ingested.

Neeld's refusal is the same class: his only material is genuinely his,
and belongs to a 2016 race in a different district.

**Rule: verify the office and the cycle, not just the candidate.**

### A guard that rejects bad data must say what happens to the good data it displaces

Found by the #38 money re-pull. `normalizeCoverageEndDate` correctly
drops a coverage date in the future — `/candidate/{id}/totals` reports
the MAX coverage across a candidate's filings, including periods that
have not closed. On its own, that guard also **erased a date an earlier
pull had correctly established**.

Dan Bilzerian is the worked example, and was already the case named in
that function's own doc comment. His committee filed an empty October
Quarterly (receipts 0, coverage through 2026-09-30) beside two real
reports. An earlier pull had his genuine $1,241,449.83 as through
2026-07-29; this pull saw only the future date and would have written
`null`, leaving `DonorProfile` rendering his figure with no date at all.

`retainedCoverageEndDate()` keeps the known date, but **only when
receipts are byte-identical** to what produced it. Different receipts
mean activity landed after that period closed, so pairing a new total
with the old date would understate freshness — a quieter lie than
showing no date.

## What ran

1. **#36 — `--only-slug` fix (PR #45).** The flag compared against
   `ballotpedia_slug`, a field **no candidate in these fixtures
   carries**, so it matched nobody and every synthesis run went
   race-wide, regenerating stances for already-live candidates with a
   human diff as the only protection. Now matches the effective slug;
   an unmatched value exits 1 before spending a token.
2. **#37 — two-way match rule (PR #46).** The CTA required 3+ profiled.
   Ten contested races hold exactly two candidates and profile both, so
   they could never reach 3 — including the **U.S. Senate Democratic
   primary**, the highest-profile race on the site. `matchIsOpen()` now
   lives beside `coverageCopy()` so the CTA and the "N of M" label
   cannot disagree.
3. **#39–#44 — discovery (PR #48).** Five races sourced, one refused.
   Seeded to production with Tommy's explicit approval.
4. **#38 — money re-pull (PR #49).** All 57 races, 225 fetches, 0
   failures. **Not one of the 98 active candidates changed
   `total_raised`.** 74 already sat at 2026-07-29, which *is* the 12-day
   pre-primary window. No seed was run and none was needed.
5. **Triage of epic #8 and children #12–#16.** #12 and #13 verified
   complete against production and closed. #8, #14, #15, #16 closed as
   superseded.
6. **The verification pass and its corrections (PR #51).** Above.
7. **Second search round (PR #51).** Murphy and Gambaro sourced and
   activated; Wells, Asensio, Power, Lewis, Rowell, Jones refused.
8. **Date-awareness (PR #51).** Nothing branched on the election date, so
   on 2026-08-19 the site would still have counted down to a finished
   primary and invited voters to rank its candidates.
   `electionHasConcluded()` is now the single decision point: a concluded
   race keeps its scorecards as a record, shows a "Primary held" notice,
   and drops the match CTA. **It states no outcome** — there is no
   results source in this repo, and implying a winner would be far worse
   than a stale date. Election day itself stays live; an unparseable date
   is never treated as past.
9. **Migration 018 — `infrastructure` (PR #51, applied).** The taxonomy
   had no home for roads, transit, utilities or broadband. The
   synthesizer reached for `infrastructure` unprompted for Gambaro;
   forced to choose among the existing 17 it picked `housing`, which
   would hand someone filtering Housing an infrastructure statement.
   `issues` is now 18 rows, verified with 0 orphaned `issue_slug` values
   across all 441 stances.
10. **Per-stance source attribution (PR #51).** The root cause behind
    defect 3 above. Themes may declare `source_url`; the model names the
    one a stance draws from, and a source the input never offered is
    refused as a fabricated citation, exactly like a fabricated roll-call
    id. Proved by re-authoring Albers: all 8 stances now cite the page
    their claim is on. **A theme spanning two pages cannot be cited
    correctly however good the pipeline is** — the theme is the unit of
    attribution, so split themes at the source seam.

## Judgment calls

- **Seeded before merge.** The five candidates were seeded to production
  while PR #48 was still open, because no migration was involved and the
  live 3+ rule already supported them. Production was intentionally
  ahead of `main` for about an hour. Recorded here so it does not read
  as drift later.
- **Did not seed the money re-pull.** `fec_totals` is not a seeded
  column, and neither `total_raised` nor `fec_coverage_end_date` changed
  for any active candidate, so seeding was a provable no-op. Verified
  rather than assumed.
- **Fixed the coverage-date defect inside the data ticket.** #38 was
  scoped as a re-pull, and this added code. The re-pull could not be
  called done while running it made a live figure worse, so the fix
  travelled with it rather than becoming a ticket nobody would open.
- **Capped discovery at one success per race.** See the table above.
- **Closed four tickets as superseded rather than doing them.** #8,
  #14, #15, #16 assumed GDELT and Wikipedia would carry thin
  challengers. Both produce 0. Leaving them open would keep pointing
  future sessions at methods that do not work.

## Method notes for the next session

- **Sourcing that works:** web search → `ingest:author` →
  `synth:stances --only-slug` → `review:activate` → `seed:candidates`.
  Hit rate held at **~43% per candidate** today (5 of 15 candidates,
  5 of 6 races), matching prior runs. Every automated sweep remains 0%.
- **New source type:** the **News Collaborative of Central Florida**
  voter's guide publishes candidates' own questionnaire answers,
  unedited, per race — dated, substantive, first-party. Format:
  `clickorlando.com/voters-guide/2026/07/31/2026-voters-guide-us-house-district-<N>-<democratic|republican>-primary/`.
  Central Florida districts only. It sourced Grayson and confirmed
  FL-06 R.
- **`curl` with a browser User-Agent beats WebFetch** on accordion or
  collapsed content. WebFetch returned only the headings of Albers'
  issues page; curl returned the full text, which is what made him
  activatable. WebFetch is 403'd by ballotpedia.org and house.gov;
  localcandidates.org 429s.
- **Always confirm a new guard fails on the old behaviour first.** Done
  for all three code changes today: #45 (7 of 22 fail), #46 (2 of 35),
  #49 (3 of 16). A guard not proved against the old data is not a guard.
- **Never `--delete-branch` a PR another PR is stacked on.** Merging
  #45 that way auto-closed stacked PR #47, and a closed PR whose base
  branch is gone can be neither reopened nor retargeted. Recovery is
  `git rebase --onto origin/main <old-base-sha> <branch>`, force-push,
  open a fresh PR (#48). Merge stacks bottom-up and retarget children to
  `main` *before* merging the parent.

## Open after this run

**Nothing is open.** 0 GitHub issues, 0 pull requests, and the remote
holds `main` alone. Migrations 001–018 are applied.

What remains is bounded and recorded, not pending:

1. **FL-19 D holds at 2 of 3.** Blocked on Neeld having published
   nothing. Reopen #40 only if that changes before 2026-08-18.
2. **FL-02 R is 4 of 8, FL-06 R is 4 of 5.** Every uncovered candidate in
   both races is refused with a recorded reason — dead domains, a 2020
   platform, a single-issue grievance site. Not a backlog.
3. **The ~390 stances predating today** were verified by the
   2026-08-07 run's adversarial verifier, not by today's pass. A scan
   found none of the two detectable defect classes among them. The
   "claim is not at the cited URL" class cannot be detected offline for
   candidates whose sources were not re-read.
4. **No post-primary decision beyond the honest freeze.** The site will
   handle 2026-08-19 on its own — record kept, no results claimed. If
   results or a general-election surface are ever wanted, that is a new
   product, not a fix.
