@AGENTS.md

# Voter — 2026 Federal Primary Match Tool

A scorecard-and-LLM-match tool for the 2026 federal midterm primaries
(House, Senate, Governor; May–September 2026). Voters enter a zip, browse
party-themed candidate scorecards, and get a personalized ranking via free-text
input matched against synthesized candidate stances.

## Architecture

- **Frontend:** Next.js 16 (App Router, Turbopack) + React 19 + Tailwind 4
- **Backend / DB:** Supabase (Postgres + PostGIS) with RLS
- **LLM:** Anthropic Claude Haiku 4.5 — used both for the live `/api/match` and
  offline candidate-stance synthesis. Cheapest tier is sufficient with
  disciplined prompting + manual review. Mock fallback when no key set.
- **Hosting:** Vercel
- **Auth:** None. Anonymous sessions via the `voter_session` httpOnly cookie
  (issued by middleware), with consent state in `voter_consent` (client-readable).

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
2. User enters zip → `/race-picker` lists matching primaries (currently mock
   data; real lookup will use US Census Geocoding API).
3. User picks a race → `/scorecards/[raceId]` renders the carousel.
4. Carousel interactions (`viewed`, `saved`, `viewed_detail`, dwell_ms)
   POST to `/api/interaction` (gated on consent).
5. CTA → `/match`: 5-issue QuickPoll (weighted 1–5) + free-text textarea.
6. Submit → `/api/match` (Haiku + Zod-validated JSON, cached, rate-limited),
   ranked results stored in sessionStorage and rendered at `/match/results`.
7. Share button → `/share?race=…&c=…&s=…` (party-themed share card +
   `/api/og` party-themed OG image).
8. `/data-rights` → export-my-data, delete-my-data, opt-out.

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
    api/
      match/, candidates/, interaction/, quick-poll/,
      consent/, visit/, data-rights/, og/
  components/
    ScorecardCarousel.tsx     # Horizontal-scroll on mobile, 4-col grid on desktop
    CandidateScorecard.tsx    # Single party-themed card
    CandidateDetail.tsx       # Full record with tabbed sub-views
    DonorProfile.tsx, VotingRecordList.tsx, StatementTimeline.tsx
    QuickPoll.tsx, FreeTextMatcher.tsx, MatchScoreBadge.tsx
    ConsentBanner.tsx, InconsistencyBadge.tsx, Nav.tsx
  lib/
    api-clients/              # FEC, GovTrack, Wikipedia, Ballotpedia (pipeline only)
    llm/
      match.ts                # Live Haiku matcher + mock fallback
      curate.ts               # Offline stance synthesizer with citation validation
      extract-platform.ts     # Wikipedia/campaign-site → structured positions
      classify-industries.ts  # FEC contributions → 19-bucket industry tags
    cookies.ts (server-only), consent.ts (server),
    consent-client.ts (client), consent-shared.ts (constants)
    session.ts, events.ts, supabase.ts, dates.ts, party-theme.ts,
    geo.ts, analytics.ts, visit-tracker.ts,
    interactions-client.ts, issues.ts
    data/races.ts, data/candidates.ts (server-side Supabase queries)
  middleware.ts               # Issues voter_session, captures utm_*
scripts/                      # Offline data pipeline (not in production runtime)
  _env.ts                     # Dotenv loader that overrides inherited shell env
  ingest/                     # fetch_fec, fetch_platform (Wikipedia), fetch_campaign_site
                              # (Playwright), author_platform, classify_industries,
                              # fetch_votes (GovTrack), fetch_statements,
                              # fetch_news_statements (NewsAPI), import_hud_zip_cd
  synthesize/                 # Haiku stance synthesis + inconsistency flags
  review/                     # Per-candidate review docs + activate + preview_scorecard
  seed/                       # Service-role Supabase upserts
supabase/
  migrations/                 # 001 base, 004 primary pivot, 005 RLS, 006 issues seed,
                              # 007 text IDs, 008 races RLS
  seed/                       # candidates/*.partial.json fixtures, raw/ cache, review/ docs
public/
  mockup-mobile.html, mockup-desktop.html  # Design source of truth
  voter-mockups.zip
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

App runtime: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`ANTHROPIC_API_KEY` (optional — mock fallback otherwise),
`MATCH_API_DISABLED` (kill switch).

Data pipeline only: `FOLLOWTHEMONEY_API_KEY` (donor industries — replaces
the retired OpenSecrets API), `FEC_API_KEY` (fundraising totals),
`SUPABASE_SERVICE_ROLE_KEY` (seed writes). Voting records use GovTrack
which is keyless (replaced ProPublica Congress, sunset 2023). See `.env.example`.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
