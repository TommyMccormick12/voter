# Changelog

All notable changes to the voter project. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.5.0] - 2026-05-10

Phase C: Wikipedia-sourced policy positions, restoring the "stated platform"
data leg after Ballotpedia 2026 federal coverage proved too thin to use.

### Added

- **`src/lib/api-clients/wikipedia.ts`** — keyless Wikipedia client.
  Extracts bio (lead paragraph), campaign / official website from
  infobox, and the full "Political positions" section text + subsection
  labels. Handles Wikipedia's modern 2023+ HTML where section headings
  are wrapped in `<div class="mw-heading">` containers.
- **`src/lib/llm/extract-platform.ts`** — Haiku-based extraction of
  structured `{issue_slug, summary, source_excerpt}` positions from
  long-form Wikipedia text. Same 10-issue taxonomy as synth:stances.
  Zod-validated, disk-cached by content hash. ~$0.003-0.008/candidate.
- **`scripts/ingest/fetch_platform.ts`** — driver. For each candidate:
  looks up Wikipedia by name (tries `First Last` then full name), pulls
  bio + website + political positions, hands to Haiku for extraction,
  writes to fixture as `key_messages`, `campaign_themes`, and
  `platform_excerpts` (preserves the source quote for review docs).
- **npm script** `ingest:platform` wired between `ingest:fec` and
  `ingest:industries`.

### Verified

End-to-end against Maxwell Frost (FL-10 D):
- Wikipedia: 5.4 KB "Political positions" section, 9 subsections
- Haiku extracted 7 positions (climate, guns, healthcare, criminal_justice,
  housing, foreign_policy, immigration) for 1530/766 tokens (~$0.005)
- synth:stances output went from 2 stances → **7 stances** with rich
  per-issue track-record annotations
- synth:flag correctly caught a track_record_note that referenced a bill
  not in the citations field — prevents activation until corrected

### Files

- ADD src/lib/api-clients/wikipedia.ts
- ADD src/lib/llm/extract-platform.ts
- ADD scripts/ingest/fetch_platform.ts
- MOD package.json (ingest:platform)
- CACHE supabase/seed/raw/anthropic-platform/, supabase/seed/raw/en.wikipedia.org/

### Cost picture (updated)

Tier 1 FL (~50 candidates) total Haiku cost:
- Platform extraction: ~$0.30
- Industry classification: ~$0.40
- Stance synthesis: ~$0.05
- **Total: ~$0.75**

## [0.4.0] - 2026-05-10

Donor industry classification via Haiku — restores the "Top funded by
[industry]" angle without OpenSecrets or FollowTheMoney (both retired).
Replaces the dead ingest:opensecrets step with ingest:industries.

**How it works:** FEC publishes itemized individual contributions over $200
with `contributor_employer` + `contributor_occupation` strings. We pull the
top 100 contributions per candidate, aggregate by employer, hand the unique
employer list to Haiku in one batched call, and validate the response against
a fixed 19-bucket taxonomy via Zod. Aggregate amounts by bucket → ranked
industries.

**Verified against Maxwell Frost (FL-10):** 25 contributions → 9 unique
employers → 5 industry buckets in 535/243 input/output tokens (~$0.0017).
Real correct classifications: "Losey PLLC" → Legal, "Bodeen Music and Sound
Design" → Media & Entertainment, "Bethesda Terrace Management" → Real Estate.

### Added

- **`src/lib/llm/classify-industries.ts`** — pure classification function.
  Fixed 19-bucket taxonomy, Zod-validated Haiku response, disk-cached by
  content hash so re-runs are free. Throws clear error if `ANTHROPIC_API_KEY`
  is missing.
- **`scripts/ingest/classify_industries.ts`** — driver. For each candidate:
  finds principal FEC committee, pulls top 100 itemized contributions,
  aggregates by employer, classifies via Haiku, writes `top_industries`
  and `top_donors` to the partial fixture.
- **FEC client additions** in `src/lib/api-clients/fec.ts`:
  - `getCommitteesForCandidate(candidateId, cycle)` — lists committees for a candidate
  - `getItemizedContributions(committeeId, cycle, limit)` — Schedule A pull, sorted by amount desc
- **npm script** `ingest:industries` wired into `package.json` between
  `ingest:fec` and `ingest:votes` in the pipeline.

### Changed

- **`scripts/README.md`** — pipeline walkthrough now uses ingest:industries
  in place of the dead ingest:opensecrets step. Cost guardrails updated
  (Haiku is now ~$0.008/candidate when industry classification is included).
- **`.env.example` / `.env.local`** — removed `FOLLOWTHEMONEY_API_KEY`
  (also retired). Industry data needs no env var beyond `ANTHROPIC_API_KEY`
  and `FEC_API_KEY`, both already in place.

### Removed

- `scripts/ingest/fetch_opensecrets.ts` — OpenSecrets API was retired.
- `src/lib/api-clients/opensecrets.ts` — dead client.
- `ingest:opensecrets` npm script.
- `FOLLOWTHEMONEY_API_KEY` env slot — service also retired.

### Cost picture

Per candidate: ~$0.007-0.008 Haiku cost for industry classification + ~$0.001
for stance synthesis = **~$0.008 total**. Tier 1 FL (~50 candidates): ~$0.40.
All cached on disk under `supabase/seed/raw/anthropic-classify/` — re-runs
are free.

## [0.3.1] - 2026-05-10

Voting-record data source swapped from ProPublica Congress (sunset 2023)
to GovTrack (keyless, actively maintained). Documents the OpenSecrets
retirement and points the donor-industries env slot at FollowTheMoney
as the replacement.

Verified end-to-end against Maxwell Frost (FL-10): 5 most recent votes
captured with real bill IDs (FISA reauthorization, Farm Bill), correct
positions, correct dates. No API key required.

### Added

- **`src/lib/api-clients/govtrack.ts`** — keyless GovTrack client with
  `findMember(name, state, chamber)`, `getMemberVotes(id, limit)`,
  `getVoteDetail(voteId)`. Caches the current-Congress roster (~538
  records) for the duration of a script run.
- **`scripts/ingest/fetch_votes.ts`** — replaces `fetch_propublica_votes.ts`.
  Drives the GovTrack client + retains the same partial-fixture shape so
  downstream synthesis and seed steps work unchanged.
- **`FOLLOWTHEMONEY_API_KEY`** slot in `.env.example` / `.env.local` —
  closest free replacement for OpenSecrets' retired industry-classification
  API. Sign up at https://www.followthemoney.org/our-data/apis/.

### Changed

- **npm script** `ingest:propublica` → `ingest:votes`. Source-agnostic name.
- **Default `source` string** for voting record rows (`scripts/seed/seed_candidates.ts`)
  changed from `'propublica'` to `'govtrack'`.
- **Per-candidate review docs** (`scripts/review/generate_review_doc.ts`)
  now surface Bioguide ID + GovTrack ID instead of the ProPublica member ID.
  Legacy `propublica_member_id` field is preserved in the output for any
  pre-swap fixtures still on disk.
- **UI source-label mappers** (`CandidateScorecard.tsx`, `CandidateDetail.tsx`)
  now recognize GovTrack URLs (the scorecard already did; detail page added).
  ProPublica mapping kept for backwards compat with existing mock data.
- **scripts/README.md** + **CLAUDE.md** updated to reflect the new data
  sources, cost guardrails, and keyless services.

### Removed

- `src/lib/api-clients/propublica.ts` — superseded by `govtrack.ts`.
- `scripts/ingest/fetch_propublica_votes.ts` — superseded by `fetch_votes.ts`.
- `PROPUBLICA_API_KEY` env slot — no longer needed.
- `OPENSECRETS_API_KEY` env slot — OpenSecrets retired their API.

### Known limitations

- **Industry-level donor profiles** unavailable until FollowTheMoney key
  lands. Without it, donor card falls back to raw FEC contributor names
  with no industry buckets (no "Top funded by oil & gas" pill).
- GovTrack's `/role` endpoint doesn't expose useful filter fields beyond
  `current=true`; we bulk-fetch and match client-side. One ~120KB call
  per script run, cached.

## [0.3.0] - 2026-05-10

Phase 2C scope-narrowing: **Florida-only** routing wired end-to-end. Any FL zip
now resolves to its district's House primary (R + D) plus statewide Senate and
Governor primaries. Non-FL zips get an explicit "Florida only — for now" empty
state instead of a silent zero result.

Races render with "Candidate data being curated" until the offline pipeline
runs with real API keys (OpenSecrets / ProPublica / FEC / Anthropic). The
code-side unblock is the prerequisite — the moment keys arrive, candidates
appear automatically.

### Added

- **`supabase/seed/zip-districts.json`** — hand-mapped FL zip → district lookup
  for ~50 zips across all 28 districts. Sourced from public 2022 FL redistricting
  maps. Will be regenerated from the HUD ZIP-to-CD crosswalk (or fixed Census
  client) before Tier 2/3 ingest — see plan §15.5b.
- **FL Tier 1 race entries** in `src/lib/mock-data.ts` — statewide Senate R/D,
  Governor R/D (open seat post-DeSantis), and 6 contested House primaries
  (FL-10, FL-13, FL-15, FL-23, FL-27, FL-28 — each R + D). Election date
  `2026-08-18`. Race objects only; candidate data populated by the pipeline.

### Changed

- **`getMockRacesForZip()`** — replaced the 9-entry hardcoded `ZIP_TO_RACE_IDS`
  with a function that reads `zip-districts.json`, filters to `state === 'FL'`,
  and constructs the 6 race IDs (district House R + D + statewide Sen R/D +
  Gov R/D) using the canonical `race-fl-{seat}-{party}-2026` convention.
  Non-FL zips return `[]`.
- **`/race-picker` empty state** — "No primaries in your district yet" →
  "Florida only — for now" with August 18, 2026 deadline and a "Try a Florida
  zip →" CTA.
- **Homepage hero copy** — "Find your candidates for the 2026 federal midterm
  primaries" → "Find your candidates for the 2026 Florida primary." Signals
  scope honestly to non-FL visitors before they enter a zip.
- **`/race-picker` page subtitle** — "House, Senate, and Governor races ·
  May–September 2026" → "House, Senate, and Governor · Florida primary
  August 18, 2026".

### Known follow-ups

- **Census client bug** (plan §15.5b): `src/lib/api-clients/census.ts:30`
  passes bare zips to the one-line-address endpoint, which expects full street
  addresses and returns null. Fix before national rollout. Recommended path:
  swap to HUD ZIP-to-CD crosswalk.
- **ProPublica API health check** (plan §15.5): Congress API was sunset in
  2023. Smoke test before Tier 1 ingest; swap to congress.gov (LOC) if needed.

## [0.2.0] - 2026-05-10

Major pivot from Phase 1 (issue-ranking + community comparison) to a 2026
federal midterm primary scorecard tool with LLM-powered free-text matching.

### Added

- **Carousel candidate scorecards** at `/scorecards/[raceId]`. Horizontal scroll-snap
  on mobile, 4-column grid on desktop. Party-themed cards (R = red, D = blue,
  I = violet) with stances, donor pills, and track-record annotations that surface
  stated-vs-actual gaps.
- **Race picker** at `/race-picker?zip=X`. Shows federal primaries near the entered
  zip with a countdown to election day.
- **Candidate detail** at `/candidate/[slug]` with tabbed stances / donors /
  voting record / statements, plus inconsistency flags when stances contradict
  voting record or donor profile.
- **LLM match flow** at `/match` — 5-issue weighted poll + free-text textarea →
  ranked candidates with match scores at `/match/results`. Uses Anthropic Claude
  Haiku 4.5 when `ANTHROPIC_API_KEY` is set; falls back to a deterministic local
  heuristic when not.
- **Shareable match results** at `/share?race=…&c=…&s=…` with party-themed Open
  Graph images at `/api/og`. Native share sheet on mobile, clipboard fallback elsewhere.
- **Cookie-based anonymous sessions** via `voter_session` (httpOnly) and granular
  consent (`voter_consent`) covering analytics + data-sale + marketing tiers.
  First-party only, no third-party trackers, no fingerprinting.
- **Right-to-know / right-to-delete** at `/data-rights` — anonymous data export
  and cascade deletion. Privacy and Terms pages.
- **Multi-source offline data pipeline** under `scripts/` for ingesting candidate
  data from Ballotpedia, OpenSecrets, ProPublica, FEC, and US Census, synthesizing
  stances with Haiku, flagging inconsistencies, and seeding Supabase. 13 npm
  scripts: `ingest:* / synth:* / review:* / seed:*`. End-to-end NJ-07 walkthrough
  in `scripts/README.md`.
- **Citation validation** in offline LLM synthesis — every track-record citation
  Haiku produces is whitelist-checked against real `bill_id` / `statement_id`
  values from the input. Refuses to write fabricated citations.
- **Schema migrations 004, 005, 006** — `candidate_interactions` (replaces
  `candidate_swipes`), `candidate_donors`, `candidate_top_industries`,
  `candidate_voting_record`, `candidate_statements`, `llm_matches`,
  `quick_poll_responses`, `session_visits`, `consent_audit`, plus the
  `candidate_data_completeness` view.
- **Anonymous engagement tracking** via `/api/interaction`, `/api/visit`,
  `/api/quick-poll` (all gated on consent).
- **HTML design mockups** at `public/mockup-mobile.html` and
  `public/mockup-desktop.html` (design source of truth).

### Changed

- **README.md** — replaced the unmodified `create-next-app` boilerplate with a
  project-specific quickstart. Mock data ships in the repo so the app works end
  to end without API keys. Cuts contributor TTHW from ~12 min to ~2 min.
- **CLAUDE.md** — rewrote to reflect the post-pivot architecture: scope locked
  to 2026 federal primaries, multi-source data pipeline, Haiku-with-citation-validation
  synthesis, cookie consent strategy, offline pipeline walkthrough.
- **Nav copy** — "All Races" → "Find your primary" (links `/race-picker`).
- **Mobile consent banner** — compressed from ~280px to ~80px tall (single-line
  mobile copy + inline buttons). Three stances now visible above the banner on
  the scorecards page instead of just the hero.
- **Touch targets** — promoted Save / Full record / Find primary / Find my best
  match / footer links / consent buttons to a 44px minimum (iOS HIG / Material).

### Fixed

- **IP / user-agent hashing** (`src/lib/geo.ts`) — replaced public-derivable
  daily-salt SHA-256 with HMAC-SHA-256 keyed on `IP_HASH_SECRET`. The previous
  implementation let SHA-256 brute-force IPv4's 2^32 keyspace in ~5 min on
  commodity GPUs, defeating the privacy guarantee on `consent_audit.ip_hash`.
  Production refuses to hash with a missing or short secret (returns null).
- **`/api/match` rate limiting** — added in-memory token bucket (10/hr/session,
  30/hr/IP) with 429 + Retry-After. Closes the LLM-cost amplification vector
  identified in `/cso` Finding 2.
- **Cross-race share URLs** — `/share` and `/api/og` now validate that the
  candidate slug belongs to the named race. Stale or hand-edited URLs fall
  through to the generic invite instead of rendering nonsense (e.g., a Democrat
  inside an "NJ-07 (R)" header).
- **Mock match algorithm** — fixed scoring that ignored user priorities and
  always returned ~88% for the same candidate regardless of input. Now scores
  candidates by alignment on the user's quick-poll-weighted issues.
- **Date off-by-one** — election dates, vote dates, and statement dates now use
  local-date math via `src/lib/dates.ts` instead of UTC parsing that shifted
  dates by a day in non-UTC timezones.
- **Data-rights leak** — `/api/data-rights` GET response no longer includes the
  raw session token in nested rows; pseudonym + omitted `ip_hash` only.
- **OG image generation** — fixed Satori children-shape crash on share URLs and
  switched to hex colors throughout (gradient malformed bug).
- **Cookie consent flow** — removed double-encoding (Next handles URL-encoding
  itself); split client/server consent helpers to avoid `next/headers` leaking
  into client bundles.

### Removed

- Phase 1 routes: `/priorities`, `/compare/[a]/[b]`, `/races`. Each returns 404
  post-pivot.
- `RankingInterface` component, `src/lib/rankings.ts`, `tests/rankings.test.ts` —
  the issue-ranking flow this codebase shipped at v0.1.0 has been retired in
  favor of carousel scorecards and the LLM match flow.

### Security

- See `.gstack/security-reports/2026-05-10-172925.md` for the full `/cso` audit
  (2 HIGH findings fixed, 1 MEDIUM tracked upstream).

### Tests

- 16 (Phase 1) → 29 tests. New: `tests/geo.test.ts` (HMAC hashing, prod-refusal),
  `tests/rate-limit.test.ts` (token bucket caps, IP-vs-session, retry-after).

### Known limitations

- App ships with hardcoded mock fixtures. Real data requires running the
  `scripts/` pipeline against API keys (OpenSecrets, ProPublica, FEC, Anthropic,
  Supabase service role).
- Rate limiter is per Lambda instance. For production traffic, swap
  `src/lib/rate-limit.ts` for Vercel KV or Upstash Redis (interface stays the
  same).
- `postcss <8.5.10` transitive CVE via Next 16 — practical impact zero in
  current architecture; tracking upstream patch.

## [0.1.0] - 2026-05-04

Initial Phase 1 ship: zip → rank issues → community comparison → share. See
`git log` for the granular commit-by-commit history of the design-review pass
and the final ship of the issue-ranking flow.
