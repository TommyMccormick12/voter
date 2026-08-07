@AGENTS.md

# Voter — 2026 Federal Primary Match Tool

A scorecard-and-LLM-match tool for the 2026 federal midterm primaries
(House and Senate; May–September 2026). Scope is federal-only — no
Governor surface (Decision 8). Voters enter a zip, browse
party-themed candidate scorecards, and get a personalized ranking via free-text
input matched against synthesized candidate stances.

## Architecture

- **Frontend:** Next.js 16 (App Router, Turbopack) + React 19 + Tailwind 4
- **Backend / DB:** Supabase (Postgres + PostGIS) with RLS
- **LLM:** Anthropic Claude Haiku 4.5 — used both for the live `/api/match` and
  offline candidate-stance synthesis. Cheapest tier is sufficient with
  disciplined prompting + manual review. Mock fallback when no key set.
- **Hosting:** Vercel
- **Auth:** No user auth on the voter-facing surface. Anonymous sessions
  via the `voter_session` httpOnly cookie (issued by middleware), with
  consent state in `voter_consent` (client-readable). The `/admin`
  dashboard is gated by HTTP Basic Auth (username `admin`, single
  `ADMIN_PASSWORD` env var, constant-time compare in Edge runtime).

## Key design decisions

- **Pivoted from Phase 1 issue-ranking → carousel scorecards + LLM match.**
  The old `/priorities`, `/compare`, and `/races` routes have been deleted.
- **Scope locked to federal primaries only.** No general election, no municipal
  races, no ballot initiatives. Every active race is `election_type='primary'`.
- **Carousel, not Tinder.** Horizontal scroll-snap on mobile, 4-col grid on
  desktop. Browsing is navigation, not rejection — interactions live in
  `candidate_interactions` (viewed / saved / viewed_detail / dwell_ms), never
  swipe_left.
- **Party-color theming everywhere** (R=red, D=blue, I=violet) via
  `src/lib/party-theme.ts`. Same hex palette in scorecards, detail, OG image.
- **Multi-source candidate data** — stated platform (Ballotpedia), donors
  (OpenSecrets/FEC), voting record (ProPublica, incumbents only), public
  statements (campaign sites). Synthesized into `top_stances` with
  `track_record_note` annotations that surface stated-vs-actual gaps. This is
  the differentiator vs ISideWith/Vote Smart.
- **Cookie-based engagement capture for B2B sentiment data**, gated on
  granular consent (`consent_analytics` + `consent_data_sale`, separate
  toggles). First-party only. No third-party trackers, no fingerprinting.
  Aggregate-only sales (≥100 sessions per district per report).
  See `src/lib/consent.ts`, `consent-client.ts`, `consent-shared.ts`.
- **LLM cost control.** `(free_text_hash, race_id)` cache before every Haiku
  call (`llm_matches` table). `MATCH_API_DISABLED=true` env kill switch.
  Mock heuristic fallback when no `ANTHROPIC_API_KEY`.
- **Citation validation** in offline synthesis (`src/lib/llm/curate.ts`):
  every `track_record_citations[]` entry from Haiku must reference a real
  `bill_id` (from voting record) or `statement_id` (from statements) in the
  input. Throws on fabricated citations, before the fixture is written.

## Data flow

1. User lands on `/` → middleware issues `voter_session` cookie + captures utm_*.
2. User enters zip → `/race-picker` lists matching FL primaries via the
   2026 district map: the EOGPCRP2026 shapefile, a precomputed ZIP→district
   crosswalk built by intersecting Census ZCTAs against it, and — for
   split ZIPs that straddle a district line — a street address geocoded
   with the free Census geocoder, then resolved by point-in-polygon
   (turf.js) against the shapefile. The address itself is never stored or
   logged, only the resolved district (see Spec A3). Non-FL ZIPs see an
   honest "Florida only for now" empty state.
3. User picks a race → `/scorecards/[raceId]` renders the carousel.
   Single- and two-candidate races soft-disable the match CTA (match
   flow only delivers signal at 3+ candidates).
4. Carousel interactions (`viewed`, `saved`, `viewed_detail`, dwell_ms)
   POST to `/api/interaction` (gated on consent, rate-limited).
5. CTA → `/match`: 5-issue QuickPoll (weighted 1–5) + free-text textarea.
6. Submit → `/api/match` (Haiku + Zod-validated JSON, cached, rate-limited
   10/hr/session + 30/hr/IP), ranked results persisted to `llm_matches`
   and rendered at `/match/results`, keyed by match id/params in the URL
   or server state — never sessionStorage, so the page survives a refresh
   or a deep link (Spec C4). Heuristic-fallback results (`source: 'mock'`)
   are labeled "estimated match" in the UI.
7. Share button → `/share?race=…&c=…&s=…` (party-themed share card +
   `/api/og` party-themed OG image).
8. "Report inaccurate" button on `/candidate/[slug]` → `/api/report`
   queues a row in `candidate_reports` (factual_error / wrong_attribution /
   outdated / other; optional email; HMAC IP hash for de-dup).
9. `/data-rights` → export-my-data, delete-my-data, opt-out.
10. Operator views `/admin` (Basic Auth) → top-line counts, top races by
    views, top saved candidates, open-report queue, Anthropic spend
    estimate. Service-role Supabase queries; never exposed to the client.

## Project structure

```
src/
  app/
    page.tsx                  # Landing — zip entry → /race-picker
    race-picker/              # Show federal primaries matching the zip
    scorecards/[raceId]/      # Carousel of candidate scorecards
    candidate/[slug]/         # Full candidate detail (stances, donors, votes, statements)
    match/
      page.tsx                # QuickPoll + FreeTextMatcher
      results/                # Ranked candidates with match scores
    share/                    # Shareable match-result card + OG metadata
    data-rights/              # Right-to-know / right-to-delete UI
    privacy/, terms/          # Legal
    admin/                    # Read-only dashboard, gated by ADMIN_PASSWORD Basic Auth
    api/
      match/, candidates/, interaction/, quick-poll/,
      consent/, visit/, data-rights/, og/, report/
  components/
    ScorecardCarousel.tsx     # Horizontal-scroll on mobile, 4-col grid on desktop
    CandidateScorecard.tsx    # Single party-themed card
    CandidateDetail.tsx       # Full record with tabbed sub-views
    DonorProfile.tsx, VotingRecordList.tsx, StatementTimeline.tsx
    QuickPoll.tsx, FreeTextMatcher.tsx, MatchScoreBadge.tsx
    ConsentBanner.tsx, InconsistencyBadge.tsx, Nav.tsx
    ReportInaccurateButton.tsx  # Modal form for /api/report
    VisitTracker.tsx            # Mounted in layout; feeds /api/visit
    ui/                         # Shared primitives (Button, Card, Badge, states, inputs)
  lib/
    api-clients/              # FEC, Congress.gov, Voteview, Wikidata/Wikipedia,
                              # legislators crosswalk, names (pipeline only)
    llm/
      match.ts                # Live Haiku matcher + mock fallback
      curate.ts               # Offline stance synthesizer with citation validation
      extract-platform.ts     # Wikipedia/campaign-site → structured positions
      classify-industries.ts  # FEC contributions → 19-bucket industry tags
    cookies.ts (server-only), consent.ts (server),
    consent-client.ts (client), consent-shared.ts (constants)
    tokens.ts (design tokens), party-theme.ts, og-helpers.ts,
    dates.ts, geo.ts, issues.ts,
    visit-tracker.ts (in-memory consent audit only),
    interactions-client.ts, visits-client.ts,
    rate-limit.ts            # Token-bucket limiter for write APIs
    app/                     # Application modules (handler -> app -> adapter)
    data/                    # adapter-anon, adapter-service, boundary, races, candidates
    geo/                     # crosswalk, districts, census-geocode (2026 map)
  middleware.ts               # Issues voter_session, captures utm_*, gates /admin
scripts/                      # Offline data pipeline (not in production runtime)
  _env.ts                     # Dotenv loader that overrides inherited shell env
  ingest/                     # fetch_fec, fetch_platform (Wikipedia), fetch_campaign_site
                              # (Playwright), author_platform, classify_industries,
                              # fetch_votes (Congress.gov + Voteview), fetch_statements,
                              # fetch_gdelt_statements (GDELT DOC 2.0), import_hud_zip_cd
  synthesize/                 # Haiku stance synthesis + inconsistency flags
  review/                     # Per-candidate review docs + activate + preview_scorecard
  seed/                       # Service-role Supabase upserts
supabase/
  migrations/                 # 001 base, 004 primary pivot, 005 RLS, 006 issues seed,
                              # 007 text IDs, 008 races RLS, 009 candidate_reports
  seed/                       # candidates/*.partial.json fixtures, raw/ cache, review/ docs
public/                       # static assets (mockup HTMLs retired 2026-08-06;
                              # design source of truth is now code — see DECISIONS-2026-08-06.md #11)
```

## Commands

- `npm run dev` — start dev server (Turbopack)
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm test` — Vitest run
- `npm run test:watch` — Vitest watch mode
- `npm run ingest:*`, `synth:*`, `review:*`, `seed:*` — data pipeline scripts
  (see `scripts/README.md` for end-to-end FL-13 walkthrough)

## Environment variables

App runtime (required): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `IP_HASH_SECRET` (32+ random bytes for
HMAC keying of IP/UA hashes).

App runtime (admin / reports): `ADMIN_PASSWORD` (gates `/admin`;
server-only, no `NEXT_PUBLIC_` prefix), `SUPABASE_SERVICE_ROLE_KEY`
(required for `/api/report` INSERT and `/admin` reads — RLS-bypass,
never exposed to client).

App runtime (optional): `ANTHROPIC_API_KEY` (live Haiku match — mock
heuristic fallback otherwise), `MATCH_API_DISABLED` (kill switch),
`NEXT_PUBLIC_SITE_URL` (canonical URL for metadata; defaults to
`https://ballotmatch.org`), `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN` (distributed rate-limit store; falls back to
in-memory when unset).

Data pipeline only: `CONGRESS_GOV_API_KEY` (House roll-call votes —
`src/lib/api-clients/congress-gov.ts`; Senate votes come from Voteview,
which is keyless), `FEC_API_KEY` (fundraising totals). The GDELT DOC 2.0
statement ingest (`src/lib/api-clients/gdelt.ts`) is free and keyless — no
env var. Donor industries are classified downstream by Haiku from FEC's
itemized contributions — OpenSecrets and FollowTheMoney both retired
their public APIs, so no env var is needed there. See `.env.example`.

## Skill routing

Invoke the skill that matches the work. This list is the real skill set —
do not invoke a skill name that is not on this list.

**Standards skills (project):**
- `frontend-standards` — UI, components, design tokens, data states, forms, accessibility.
- `backend-standards` — handlers, API contracts, validation, authorization, errors.
- `data-and-release` — migrations, production-data protection, test selection, release gates.

**Process skills (mattpocock-skills plugin):**
- `to-spec` / `to-tickets` — turn an idea into a spec, then into tickets, before building.
- `implement` / `tdd` — build a ticket. Use `tdd` for test-first work.
- `code-review` — review a diff or branch against the standards skills above.
- `diagnosing-bugs` — investigate a failure or a regression.
- `triage` — sort and prioritize open bugs or issues.

Check process-skill output against the matching standards skill before
calling a task done.
