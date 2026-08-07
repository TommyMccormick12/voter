# Pre-primary coverage run — process record, 2026-08-07

Companion to `HANDOFF-2026-08-07.md`. Covers GitHub issue #8 and tickets
#9–#16 plus an unplanned wave 4. Primary is **2026-08-18** (11 days out).

## Outcome

| | Start of day | End of day |
|---|---|---|
| Active candidates | 9 | 90 |
| Races with any coverage | 9 of 57 | 55 of 57 |
| Races marked `no_primary` | 1 | 14 |
| Races with the match flow (3+ active) | 0 | 9 |
| Money coverage date | stale (June) | 2026-07-29 pre-primary |

Every activated candidate passed the Decision 12 gate: agent-authored
stances from sources actually read → mechanical validation → an
independent blind refutation-first verifier → the activation gates
(≥3 stances, DOE-spine candidacy for exactly that race, fresh
`verified_at`). **~70 stances were refuted and never reached voters.**

## What ran

1. **Votes re-ingest** (all 57 fixtures). Found and fixed a real bug: the
   live Congress.gov API returns `bioguideID`, the client read
   `bioguideId`, so the first live run matched zero members and would
   have written empty voting records for every incumbent. 23 incumbents
   now carry 50 recent votes each. Regression tests added.
2. **Money re-pull** (165 candidates). Pre-primary filings landed a day
   early; 120 candidates covered through 2026-07-29, 34 quarterly-only
   filers honestly at 2026-06-30, 3 explicit no-2026-filings markers.
3. **`fec_coverage_end_date`** shipped end to end (migration 014 + stamp
   + persist + select), in two phases so a merge could not break live
   candidate reads.
4. **Candidate Connection extraction** — 79 priority candidates, 44
   responded (56%, ~3× the planning estimate), concentrated among
   challengers.
5. **GDELT statement miner** built, reviewed, and repaired (PR #20).
6. **Activation waves** — incumbents, then challengers by district block,
   then wave 4 (third candidates).
7. **Wave 5 — the eleven unopposed races.** Each had exactly one
   DOE-qualified candidate but showed voters "Curating" instead of who
   advances. All eleven are now live and marked `no_primary`: Valimont,
   Cammack, Bean, Jenkins, Haridopolos, Bilirakis, Castor, Gibson, Brown,
   Locklin, Ehr. **12 stances refuted** — fabricated dollar figures, a
   wrong statutory sunset, an unsourced NRA claim, a date off by a week,
   two motion-to-recommit inversions, and a bill summary that disclosed
   only one of the bill's two subjects.

### The procedural-vote fix (wave 5)

Three verifiers hit this independently, and it inverted **both ways**.
Bean's NAY on a motion to recommit was written as voting *against* the
veterans bill — but a nay lets the bill proceed. Castor's YEA on the
*same* motion was written as *supporting* that bill — but a yea sends it
back to committee. `isProceduralVote()` now flags those rows to the
synthesis prompt with an explicit inversion warning, and discriminates a
suspension-and-pass motion (substantive) from a motion to recommit
(procedural). Six tests pin it.

The validators were wrong too: they forbade `track_record` fields for
every candidate, which is right for challengers and wrong for the sitting
incumbents in this wave. They now validate citations against the
candidate's own `voting_record`.

## Judgment calls

- **FL-18 R and FL-09 D marked `no_primary`.** The DOE spine shows
  exactly one qualified candidate in each. Scorecards stay viewable per
  Decision 9; the informational note matches the FL-10 D (Frost)
  precedent.
- **Bilzerian (FL-06 R) HELD despite passing 5/5.** Two independent
  reasons: (a) FEC returns totals with an impossible future coverage
  date and **no financial report on file**; (b) the authoring pass
  covered five platform planks and omitted his explicitly antisemitic
  ones, which misrepresents him to voters. Accurate-but-selective
  coverage is an editorial question, not an agent decision. **Awaiting
  Tommy.**
- **Patronis (FL-01 R) refused.** Sources were January 2025 special-
  election releases; he is also the sitting incumbent misclassified as a
  challenger. Needs an incumbent-style re-author against his voting
  record.
- **Escalation rounds resolved in both directions.** Robinson (FL-13 D)
  refused, upheld against the archived survey snapshot — his own answers
  contain no tax content. Singer (FL-25 R) refused, **overturned** — his
  content was verbatim in the snapshot; the first verifier had lost
  Ballotpedia access session-wide.
- **Ehr (FL-28 D) cited to an archive, not to his own site.**
  `ehrforcongress.us` presents a certificate that fails name validation.
  A verifier had read the site with certificate validation disabled and
  reported a different priorities list than the one we sourced. Neither
  the re-authoring agent nor the main loop could reproduce that through
  any path that did not bypass the certificate; three legitimate reads
  agreed with the original sourcing. **The bypass was refused** — a host
  that cannot prove its identity is exactly the condition under which
  another site's content gets published under a candidate's name. The six
  original stances stand, and every citation points at a Wayback snapshot
  of `/meet-phil/`, which also spares voters a browser security warning
  when they click through to check a claim.
- **Grayson (FL-07 D) shortfall.** His agent refused to source a House
  race from prior Senate-campaign material and declined to pad the card
  even though the prompt named the 3-candidate threshold as the goal.
  Correct behavior; recorded because it resisted stated goal pressure.

## Open decisions for Tommy

1. **Bilzerian.** ANSWERED 2026-08-07: *show his platform including all
   content.* Now 7 stances covering all 8 planks, plain and attributed,
   quoting his own words — including the "End Jewish Supremacy" plank,
   filed under `civil_rights` with the section named verbatim in the
   summary. Two blind verification rounds against a standard that fails
   BOTH sanitizing and editorializing: round 1 passed 5/7 (a spliced
   quote and two merged claims were rewritten, not dropped — dropping
   would have re-created the omission); round 2 passed 7/7. Live.
2. **Define the stance axis.** ANSWERED 2026-08-07: *a stance is an
   opinion someone holds.* Implication to implement: the summary carries
   the opinion, and `stance` expresses how strongly the candidate holds
   it — not whether they are "for or against" the topic name. The UI must
   stop rendering direction as a bare chip beside the topic
   (`Immigration: Support` for a restriction position reads backwards;
   `Education: Oppose` for a candidate who founded a school reads
   backwards). Once written into the standards, the ~dozen stances
   refuted *only* on label inversion become valid, including Speir
   (FL-16 R, 2/5).
3. **Slug taxonomy gaps.** ANSWERED 2026-08-07: *do not stick to ten
   topics; add what accurately represents candidates.* Migration 015 adds
   environment, public_safety, veterans, government_reform,
   reproductive_rights, technology, civil_rights (17 total). The
   QuickPoll still asks five (TOP_5_ISSUES), unchanged.
   **Adding slugs does not re-file existing stances** — Tommy caught this.
   A sweep of all 322 live stances across 79 active candidates flagged 9
   and moved 7 (3 climate→environment, 4 criminal_justice→public_safety);
   Salazar and Sapp were deliberately left on `climate` as defensible.
   The audit script is reusable and MUST be re-run after any future
   taxonomy change — this class of drift will recur every time.

## Backlog (non-blocking)

- **Bill-title enrichment.** Voting records display the vote question
  ("On Passage") instead of bill names. The Congress.gov client already
  has the enrichment call; it is not wired in. Data is correct — every
  vote direction was independently verified — but the presentation is
  poor. Highest-value polish item.
- **Citations should pin `roll_call_id`, not `bill_id`.** A bill with
  multiple roll calls (passage yea, motion-to-recommit nay) can resolve
  to the wrong row and display an inverted vote.
- **`no_primary` note renders on race-picker but not the scorecard page.**
  Affects Frost (FL-10 D) and Franklin (FL-18 R).
- ~~Two FEC anomalies unresolved~~ RESOLVED 2026-08-07, oppositely.
  Tommy's note that Bilzerian was self-funding exposed that the original
  "no report on file" finding queried `/candidate/{id}/filings` when F3
  reports are filed by the COMMITTEE. His committee had filed two real
  reports summing to exactly the disputed $1,241,449.83 — the money was
  always real. The actual defect was the coverage date: the totals
  endpoint returns the MAX coverage_end_date across filings including
  periods that have not closed, and an empty October Quarterly advertised
  his money as "through 2026-09-30". `normalizeCoverageEndDate` now drops
  future dates loudly. Schneider resolves the other way — zero F3 reports
  on either committee, money genuinely unsubstantiated; she is inactive.
  **Lesson: check committee-level filings, not candidate-level.**
- **FL-24 slug `kendrick-meek` conflates the candidate with his father**,
  former Rep. Kendrick Meek. The candidate is Kendrick Meek Jr.
- **Recoverable refusals.** Several stances were refuted only because
  Ballotpedia bot-blocks automated fetches; the archived snapshot can
  resolve them (Harris FL-16 D lost 2 that way). A fresh pass with search
  budget could also revisit the wave-4 shortfalls.
- **Single-source risk.** Most challenger stances rest on one campaign
  URL; one page edit invalidates a whole card.
- **Two races still have no coverage: FL-01 R and FL-13 D.** Both are
  genuinely contested. **DECIDED 2026-08-07: ship without them.** Both failed verification for real reasons — Patronis's sources
  were prior-cycle, and both FL-13 D drafts were refuted — and with 11
  days to the primary another authoring round was judged the wrong use of
  the remaining time. Nothing wrong ships; those races stay honestly
  blank.
- **Migration 012** APPROVED 2026-08-07 and ready to run. The backup gate
  resolved by inspection rather than by taking one: all three tables hold
  zero rows and no foreign key references any of them, so the drop
  destroys no data. Re-run the count queries in the migration header
  before applying if time has passed. `src/types/supabase.ts` still
  describes the three tables and must be trimmed **after** the drop runs,
  never before.

## Method notes for the next session

- **Verify the wire shape against a live response before bulk runs.**
  This caught `bioguideID` and pinned GDELT's `seendate` format.
- **Bot-blocking is not absence.** Ballotpedia returns HTTP 202/200 with
  an empty body to default agents — identical for real and fabricated
  pages. Verifiers that treated that as "unverifiable" produced false
  refutations. A browser user-agent returns the real content.
- **Escalate, do not accept, a refusal caused by tooling.** Two rounds
  ran; one upheld the refusal, one overturned it.
- **The honest-refusal rule works.** Agents returned zero stances rather
  than padding for candidates with no findable content, including under
  explicit goal pressure.
- **Check the right endpoint before concluding data is missing.** The
  Bilzerian money call was wrong because candidate-level filings do not
  include the committee's F3 reports.
- **A cached page read is not evidence.** WebFetch caches 15 minutes per
  URL, which briefly made a merged UI fix look unshipped; add a query
  param to bust it. That same tool also paraphrases — it once made
  verified verbatim summaries look sanitized. Query the DB for content
  truth, and bust the cache for render truth.
- **Expanding a taxonomy does not migrate the data already filed under
  it.** Re-run `scratchpad/audit-slugs.js` (logic recorded in PR #21)
  after any slug change.
