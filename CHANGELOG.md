# Changelog

All notable changes to the voter project. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
