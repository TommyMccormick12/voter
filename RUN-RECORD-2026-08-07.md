# Pre-primary coverage run — process record, 2026-08-07

Companion to `HANDOFF-2026-08-07.md`. Covers GitHub issue #8 and tickets
#9–#16 plus an unplanned wave 4. Primary is **2026-08-18** (11 days out).

## Outcome

| | Start of day | End of day |
|---|---|---|
| Active candidates | 9 | 78 |
| Races with any coverage | 9 of 57 | 44 of 57 |
| Races with the match flow (3+ active) | 0 | 9 |
| Money coverage date | stale (June) | 2026-07-29 pre-primary |

Every activated candidate passed the Decision 12 gate: agent-authored
stances from sources actually read → mechanical validation → an
independent blind refutation-first verifier → the activation gates
(≥3 stances, DOE-spine candidacy for exactly that race, fresh
`verified_at`). **~60 stances were refuted and never reached voters.**

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
- **Grayson (FL-07 D) shortfall.** His agent refused to source a House
  race from prior Senate-campaign material and declined to pad the card
  even though the prompt named the 3-candidate threshold as the goal.
  Correct behavior; recorded because it resisted stated goal pressure.

## Open decisions for Tommy

1. **Bilzerian.** How should the product represent a candidate whose core
   platform includes content outside the 10-issue taxonomy? Omitting it
   sanitizes him; including it needs an editorial policy. He is inactive
   until this is answered.
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
3. **Slug taxonomy gaps.** `climate` repeatedly absorbed water-quality and
   Everglades material; `criminal_justice` absorbed public-safety
   material. Candidates for new slugs: `environment`/`water`,
   `public_safety`. Recommendation: NOT before Aug 18 — the ten topics
   also drive the QuickPoll and the matching. Until then, make each
   summary name its real subject so the card stays honest under a broad
   bucket.

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
- **Two FEC anomalies unresolved:** Bilzerian (H6FL06415) and Schneider
  (H2FL13139) carry a 2026-09-30 coverage date with no report on file.
- **FL-24 slug `kendrick-meek` conflates the candidate with his father**,
  former Rep. Kendrick Meek. The candidate is Kendrick Meek Jr.
- **Recoverable refusals.** Several stances were refuted only because
  Ballotpedia bot-blocks automated fetches; the archived snapshot can
  resolve them (Harris FL-16 D lost 2 that way). A fresh pass with search
  budget could also revisit the wave-4 shortfalls.
- **Single-source risk.** Most challenger stances rest on one campaign
  URL; one page edit invalidates a whole card.
- **13 races still have no coverage**, mostly uncontested or
  no-web-presence fields.
- **Migration 012** still staged, unapplied, awaiting approval + backup.

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
