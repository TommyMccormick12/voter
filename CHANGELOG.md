# Changelog

All notable changes to the voter project. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.8.1] - 2026-05-17

Tier 2 House race ingestion sweep. Ran the full ingest pipeline against
all 22 Tier 2 FL House primary fixtures (FL-09, 11, 16, 17, 18, 19, 20,
21, 22, 24, 25, 26 × R+D where contested). 90 candidates evaluated, ~$0.40
in Haiku spend. Yielded 2 new activations and 88 review docs that
document the data state for future ingest passes.

### Added

- **Debbie Wasserman Schultz** activated in **FL-25 D** (incumbent, 4
  synthesized stances on guns / foreign_policy / criminal_justice /
  economy, 50-vote record, $2.5M raised this cycle).
- **Mario Díaz-Balart** activated in **FL-26 R** (incumbent, 9
  synthesized stances spanning healthcare / economy / taxes /
  foreign_policy / immigration / climate / guns / criminal_justice /
  education, 50-vote record, $1.5M raised).
- **22 generated review docs** under `supabase/seed/review/race-fl-*-2026/`
  documenting bio, donors, voting records, and pending data gaps for
  every Tier 2 candidate the FEC roster knows about. Reusable as
  starting points when this batch is re-run closer to the August
  primaries.

### Changed

- **TODOS.md** demotes "Tier 2 House race ingestion" P2 → P3. Root
  cause discovered during the sweep: most non-incumbent FL House
  challengers have no Wikipedia page and no usable campaign-site
  issues page this early in the cycle. Re-running the same pipeline
  won't yield more until Wikipedia + campaign coverage accumulates
  closer to the August primary date. Same finding as the deferred
  hand-authoring sweep (P4).

## [0.8.0] - 2026-05-17

Anti-spam hardening + distributed rate limits. Reports flagged from a
single IP can no longer flood the admin queue with copy-paste text; the
DB enforces dedup at insert time and the admin dashboard surfaces
clustered submissions before they become a problem. Rate limits now
share state across every Lambda instance via Upstash Redis, closing
the cold-start multiplication gap from `/cso` Finding 2.

### Added

- **Upstash Redis backend** for `src/lib/rate-limit.ts` via
  `@upstash/ratelimit` sliding-window. Shared state across every
  Lambda invocation — no more per-instance counters that an attacker
  could multiply by hitting concurrent cold starts. Falls back
  silently to the in-memory token bucket when
  `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are absent
  (local dev, CI, preview deploys without Upstash provisioned).
- **`supabase/migrations/010_report_spam_dedup.sql`** — adds a
  `description_hash` column to `candidate_reports`, backfills existing
  rows with `sha256(lower(btrim(description)))`, and creates a partial
  `UNIQUE (ip_hash, candidate_id, description_hash)` index. Same
  `(ip, candidate, text)` triple submitted twice rejects at the DB
  layer with Postgres error 23505.
- **Suspicious IP clusters section** on `/admin` — shows the top 10
  `ip_hash` prefixes (≥3 reports in 7d) with report count and distinct
  candidates targeted. Catches the next-level-up spammer who rotates
  description text but stays on one IP, beyond what the exact-text
  unique index dedups at the row layer.

### Changed

- **`checkRateLimits` is now async.** The Upstash backend is a network
  call; the in-memory fallback is wrapped in a resolved promise for
  interface symmetry. All six API route callers (`/api/match`,
  `/api/report`, `/api/interaction`, `/api/visit`, `/api/quick-poll`,
  `/api/consent`) now `await` the result.
- **`/api/report` computes `description_hash` with Web Crypto** before
  the INSERT and catches Postgres `23505` unique violations — returns
  `200 { ok: true, deduplicated: true }` silently rather than
  surfacing the conflict, so a spammer can't probe the dedup boundary.

### Fixed

- **Vitest `vi.mock` hoisting warning** in `tests/session.test.ts`.
  Removed the duplicate inner mock; the top-level mock already covers
  dynamically-imported modules after `vi.resetModules()`.

## [0.7.1] - 2026-05-17

Custom domain cutover. The site now lives at `ballotmatch.org` — shorter,
easier to drop in a text message, doesn't read like a deploy URL. The old
`voter-fawn.vercel.app` alias is retired and 404s. Share cards on Twitter,
LinkedIn, and SMS now resolve their preview images against the stable
domain instead of per-deploy hash URLs that 404 after the next deploy.

### Changed

- **Primary domain is now `ballotmatch.org`**. Apex is the canonical host;
  `www.ballotmatch.org` 307-redirects to it. Old `voter-fawn.vercel.app`
  alias removed from Vercel. Auto-deploy on push to main is unchanged.
- **`src/app/layout.tsx` adds `metadataBase`** pointing at
  `https://ballotmatch.org` (overridable via `NEXT_PUBLIC_SITE_URL` env
  var for preview-scope overrides). Next.js previously fell back to
  `VERCEL_URL` (the per-deploy hash) when resolving relative OG/Twitter
  image URLs, which meant social platforms cached preview images at
  URLs that 404 once a new deploy lands. Now they resolve against the
  stable apex.
- **README live link** updated to `ballotmatch.org`.

## [0.7.0] - 2026-05-11

Tier 1 launch readiness. The match flow no longer degrades into nonsense
on single-candidate races, every write endpoint now rejects bots, voters
can flag inaccurate stances, and there's an admin dashboard so we can see
what's working without flying blind. Tier 2 brings five FL incumbents
online; mobile QA closed the consent-banner overlay bug; the security
audit found and fixed four real issues before the first public invite.

### Added

- **`/admin` dashboard** (`src/app/admin/page.tsx`) — single-page, read-only
  view of the engagement signal: 24h/7d session, visit, interaction, and
  match counts; top races by views and top saved candidates over the last
  7 days; estimated Anthropic Haiku spend (input + output tokens × current
  pricing); and the open-reports queue with stance and category. Gated
  behind HTTP Basic Auth via `src/middleware.ts` and a single
  `ADMIN_PASSWORD` env var, with username `admin` required, constant-time
  password compare, and `noindex` + `no-store` headers on every response.
- **`/api/report`** + **`<ReportInaccurateButton />`** — voters can flag
  wrong stance attributions, outdated quotes, or fabricated bill citations
  from any candidate page. Optional email; rate-limited (10/hr/session,
  30/hr/IP); rows queue in `candidate_reports` with status `open` for
  admin review.
- **`supabase/migrations/009_candidate_reports.sql`** — new table backing
  `/api/report`: candidate FK, optional session FK, stance_id, cited_bill_id,
  category (`factual_error` / `wrong_attribution` / `outdated` / `other`),
  description, optional reporter_email, HMAC IP hash, status, and review
  timestamps. RLS: public insert, no public select. Service role only for
  admin reads. Idempotent DO block.
- **`/api/report` + 4 other write endpoints now rate-limited.**
  `INTERACTION_LIMITS`, `VISIT_LIMITS`, `POLL_LIMITS`, `CONSENT_LIMITS`,
  `REPORT_LIMITS` added to `src/lib/rate-limit.ts`. Each endpoint checks
  the session and IP buckets before the JSON parse and returns
  `429 + Retry-After` on overflow. Bot-pollution defense for the B2B
  engagement-signal tables.
- **Hand-authored Alex Vindman platform (FL Sen D)** via the
  campaign-site → JSON path. 7 key messages + 7 campaign themes across
  economy, criminal justice, housing, healthcare, education, foreign
  policy. Brings FL Sen D to 3 active candidates (Grayson, Nixon, Vindman).
- **5 Tier 2 FL incumbents activated** — Sabatini, Webster, Buchanan,
  Franklin, Donalds — bringing the Supabase active count to **18
  candidates across 12 of 38 races**.

### Changed

- **Match CTA gated on `candidates.length >= 3`.** On single- or
  two-candidate races, the "Find my best match" button is replaced with
  honest soft copy ("N candidates with policy data in this race. Explore
  their records above; match comparison opens when we have 3+ candidates.")
  Match comparison only delivers signal at 3+; below that the result is
  trivially "you match X."
- **Mobile P1 fix: consent banner no longer traps the page footer.**
  `ConsentBanner.tsx` now renders an in-flow spacer alongside the fixed
  banner so footer content (Privacy / Terms / Data Rights links, bottom
  CTAs) is reachable. Spacer height adapts to compact (150px mobile / 80px
  desktop) vs customize (320px / 240px); unmounts with the banner
  post-consent. Star tap-targets in `QuickPoll` now meet WCAG AA 44×44px;
  back link in scorecards header gained `whitespace-nowrap` to prevent
  the "All races" → "All\nraces" stack.
- **FEC display names strip honorific titles at seed time.** Names like
  `Scott Mr. Franklin` (an FEC formatting artifact) become `Scott Franklin`
  before the Supabase upsert. Strip helper exported from
  `src/lib/api-clients/names.ts`; called from `scripts/seed/seed_candidates.ts`.
  Slug remains the stable ID.
- **`/admin` Anthropic spend display** updated to reflect the actual
  configured `$100/day` cap (was `$50/day` placeholder).

### Fixed

- **`/cso` HIGH-1 — constant-time password compare.** Plain `===` in
  the `ADMIN_PASSWORD` check leaked the password byte-by-byte via
  response timing. Replaced with a pure-JS XOR loop in
  `src/middleware.ts` (Vercel Edge runtime has no `node:crypto`, so
  `timingSafeEqual` isn't available).
- **`/cso` MED-1 — `noindex` + `no-store` on `/admin`.** 401, 503, and
  authenticated 200 responses all carry `X-Robots-Tag: noindex, nofollow`
  and `Cache-Control: no-store`. Keeps the admin URL out of search and
  out of any shared cache.
- **`/cso` MED-2 — Basic Auth username gate.** The username portion of
  the credential was previously ignored; now `admin` is required.
- **`/cso` MED-4 — privacy policy disclosure.** Added a dedicated
  "Report inaccurate" section to `/privacy` explicitly stating that the
  Report form may collect an optional email, what it's used for, what
  it's never used for (sale / marketing / cross-page tracking), and the
  retention policy.
- **`/review` P2 — Basic Auth password parser handles colons.** Per
  RFC 7617 the password portion may contain colons; the previous
  `.split(':', 2)` truncated everything after the second colon. Replaced
  with `indexOf(':') + slice`. Latent bug today (current password has no
  colons), but a landmine for any future rotation.
- **GovTrack false-positive last-name match** (`§18.1`). The
  `findMember` fallback in `src/lib/api-clients/govtrack.ts` previously
  matched last-name only when full-name missed, causing Royal Webster
  (FL-11 D challenger) to inherit Daniel Webster's voting record.
  Fix: bi-directional first-name prefix check on multi-word queries,
  with an initial-only exception so `Scott Franklin` still matches
  GovTrack's `C. Franklin`.
- **FEC name-mangling on Mc/Mac/O' surnames** (`§18.2`). The
  `normalizeFecName` helper previously lowercased then re-title-cased,
  producing `Cherfilus-Mccormick` instead of `Cherfilus-McCormick`,
  which broke downstream Wikipedia and GovTrack lookups. Added a Mc/Mac/O'
  post-pass that re-capitalizes the letter after the prefix. Mac rule
  requires 3+ trailing lowercase chars to avoid false positives on
  "Macy" / "Macedo".

### Coverage at release

- **18 active candidates** across **12 of 38 races** in FL Tier 1 + Tier 2.
- 5 of 5 Tier 1 launch-readiness items shipped (§19 of plan):
  match-CTA gate, rate limits, /api/report, /admin, mobile QA.
- 5 of 5 `/cso` security findings shipped (HIGH-1, MED-1, MED-2, MED-4,
  plus the `/review` P2 follow-up).
- Production at `https://voter-fawn.vercel.app` (Vercel-assigned alias).
  Both Production and Preview scopes carry the full env var set:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `IP_HASH_SECRET`, `ANTHROPIC_API_KEY`, `ADMIN_PASSWORD`. Production
  also has `SUPABASE_SERVICE_ROLE_KEY` for `/api/report` and `/admin`.
- `npm run lint && npm test` clean; 67 tests pass.

### For contributors

- New env var **`ADMIN_PASSWORD`** required for `/admin` access.
  Server-only (no `NEXT_PUBLIC_` prefix). Set via `vercel env add` in
  both Production and Preview scopes.
- The pure-JS `constantTimeEqual` helper in `src/middleware.ts` is the
  pattern for any future Edge-runtime constant-time compare. `node:crypto`
  is not available in Edge.
- Mobile QA P0/P1/P2 baseline established at 95+ across console, links,
  visual, functional, UX, performance, content, and accessibility on
  iPhone SE / 13 mini (375×812).

## [0.6.0] - 2026-05-10

The pivot's payoff: the seeded FL Tier 1 data is now visible to real users on
a live production URL. Every page reads from Supabase (no more mock fixtures),
the ZIP routing covers all 28 FL Congressional Districts, and the site is
deployed to Vercel with auto-deploy on every push.

### Added

- **`src/lib/data/races.ts` + `src/lib/data/candidates.ts`** — server-side
  Supabase query helpers. `getRace`, `getRacesByIds`, `getRacesForZip` for race
  routing. `getCandidatesForRace` for scorecard rendering, `getCandidateBySlug`
  with a single-round-trip PostgREST embed pulling all 5 child relations
  (positions, donors, industries, voting record capped at 50 rows, statements),
  and `getCandidateSamplesForRaces` for the race-picker count badges (no N+1).
  Hard-errors when `NEXT_PUBLIC_SUPABASE_URL` is unset — no silent mock
  fallback, which was the bug class that hid an empty DB during ingest.
- **`supabase/migrations/008_races_rls.sql`** — enables RLS + public-read
  policy on the `races` table. Idempotent DO block. Closes a defense-in-depth
  gap from the original schema; the new `sb_publishable_*` anon-key format made
  the previously-permissive default no longer work.
- **`scripts/ingest/import_hud_zip_cd.ts`** + `npm run ingest:hud-zips` —
  consumes HUD's quarterly USPS_ZIP_CROSSWALK XLSX (free, signup-only) and
  writes `supabase/seed/zip-districts.json`. Got us from 56 hand-mapped FL ZIPs
  to **1,396 ZIPs covering all 28 districts** in one run.
- **`scripts/ingest/fetch_campaign_site.ts`** + `npm run ingest:campaign-site` —
  Playwright-rendered fetch of each candidate's website at common platform URL
  patterns (`/issues`, `/platform`, `/priorities`, ...), Haiku-extracts into
  the same 10-issue taxonomy as `fetch_platform.ts`. Fallback when Wikipedia
  has no "Political positions" section. Recovered FL Senate D (Grayson +
  Nixon) which had no Wikipedia coverage.
- **`scripts/ingest/author_platform.ts`** + `npm run ingest:author` — merges
  a hand-authored `{bio, key_messages, campaign_themes, website}` JSON into a
  candidate fixture. Synthesis then runs normally with the same Zod + citation
  safety net. For the long tail of D-side challengers with neither Wikipedia
  nor a usable campaign site.
- **`scripts/ingest/fetch_news_statements.ts`** + `npm run ingest:news` —
  NewsAPI.org-driven statement ingester. Quotes the candidate name + state for
  disambiguation, batches up to 10 articles per candidate, Haiku-summarizes
  into structured `candidate_statements` rows. Requires `NEWSAPI_KEY` (free
  100 req/day, 1-month archive); silently no-ops when unset.
- **`scripts/review/preview_scorecard.ts`** + `npm run review:preview` —
  generates a self-contained HTML preview of a candidate's scorecard + detail
  view from live Supabase data. Inline Tailwind CDN so the file opens in any
  browser without the dev server. For stakeholder demos and the review pass
  before activating new candidates.
- **Ex-incumbent UI affordance** in `src/components/VotingRecordList.tsx`. When
  `votes` is empty AND `incumbent: true`, renders an explanatory amber empty
  state with a GovTrack link instead of the misleading "challenger has no
  history" copy. Targets the Marco Rubio case (left Senate for SecState mid-
  cycle, still on FEC ballot, no current-cycle votes).
- **Vercel production deploy** at https://voter-k4ewj9iy9-tommymccormick12s-projects.vercel.app
  with `IP_HASH_SECRET`, `ANTHROPIC_API_KEY`, both Supabase keys set in
  Production scope. GitHub repo at https://github.com/TommyMccormick12/voter
  connected for auto-deploy on every push to `main`.

### Changed

- **Every page and API route now reads from Supabase via `src/lib/data/*`.**
  9 consumers swapped: `/race-picker`, `/scorecards/[raceId]`, `/candidate/[slug]`,
  `/match`, `/match/results`, `/share`, `/api/og`, `/api/candidates`,
  `/api/match`. `/api/og` runtime flipped from `edge` to `nodejs` to match
  `/api/match` and avoid edge-bundle weirdness with `@supabase/supabase-js`.
- **`flag_inconsistencies.ts`** Check 4: donor/industry-based contradictions
  ("Healthcare & Pharma industry contributed $6,550 despite stated support
  for...") no longer fire HIGH on missing `track_record_citations`. Donor data
  IS the cited source (rendered in the scorecard's "Funded by" section), so
  it legitimately has no `bill_id`. Bill-based contradictions still require a
  citation.
- **README.md** refreshed away from the deleted mock-data quickstart. Now
  describes the real Supabase-backed first-run flow, lists actual FL ZIPs for
  testing (32801 Orlando, 33101 Miami), adds a "Current coverage" section
  (16 races, 14 active candidates), and adds an MIT license clause.
- **`src/lib/api-clients/base.ts`** disk cache: the `fetchBrowserCachedText`
  helper grew a Playwright-aware code path used by `fetch_campaign_site.ts`.
  Module-scoped browser/context cache, polite throttling, and `closeBrowser()`
  called in script finally blocks.

### Removed

- **`src/lib/mock-data.ts`** — 754 lines of fixture-style mock data plus the
  `getMock*` function family. The hard-error contract in `src/lib/data/*` now
  prevents a misconfigured prod from silently falling back to mock content.
  Pipeline `supabase/seed/*.partial.json` fixtures remain.

### Coverage at release

- 16 FL Tier 1 race rows in Supabase (12 House × R+D, Senate × R+D, Gov × R+D).
- 14 active candidates with synthesized `top_stances` across 9 races.
- 1,396 FL ZIPs route to all 28 districts via HUD crosswalk.
- 5 e2e production endpoints verified: race-picker, scorecards, candidate
  detail, match flow, share + OG image.
- `npm run lint && npm test` clean; 29 tests pass.

### For contributors

- The `_env.ts` shim (introduced in 0.5.1) now lives in every pipeline script
  imported as `import '../_env';`. Solves the long-standing footgun where
  Node's `--env-file` flag doesn't override an inherited empty
  `ANTHROPIC_API_KEY` from the parent shell.
- `gh` CLI installed + authed against `TommyMccormick12/voter`. Future ops can
  use `gh pr create`, `gh issue list`, etc. without re-authing.
- Deployment Protection (Vercel SSO wall) is disabled — the production URL is
  publicly reachable. Re-enable in Vercel project settings if needed for
  staging.

## [0.5.1] - 2026-05-10

FL Tier 1 ingest sweep: every Tier 1 race has a row in Supabase, 10 incumbent
candidates with synthesized stances ready for the scorecard carousel. The
pipeline-level fixes that fell out of the sweep land here too.

### Added

- **All 16 FL Tier 1 races seeded:** 12 House primaries (FL-13, 15, 23, 27, 28
  × R+D), Senate R+D, Governor R+D. The 10 R-side incumbents (Luna, Lee,
  Frankel, Moskowitz, Salazar, Gimenez, Moody, Rubio, Scott, plus FL-10 D
  Frost from the earlier NJ-07 → FL-10 pilot) have synthesized `top_stances`
  and are activated.
- **`scripts/_env.ts`** — dotenv loader that OVERRIDES inherited shell env.
  Node's `--env-file` flag does NOT clobber existing vars, so an empty
  `ANTHROPIC_API_KEY` in the parent shell silently disabled Haiku for half a
  sweep before this fix landed. Imported as `import '../_env';` at the top of
  every pipeline script.
- **`supabase/migrations/007_text_ids.sql`** — convert `races.id` and
  `candidates.id` from `uuid` to `text` everywhere, plus every FK that
  references them. The app uses human-readable string IDs throughout (mock
  data, route params, ingest CLI args). Original UUID schema was incompatible
  with the app's identifier convention. Idempotent DO block.
- **`--primary-party D|R` flag** on `fetch_fec.ts` for seeding candidate
  fixtures from FEC filings directly when Ballotpedia coverage is empty.

### Changed

- **`scripts/ingest/fetch_fec.ts`** now bootstraps the `fixture.race` object
  on first seed (state, office, election_date, cycle, election_type,
  primary_party). Previously `seed_races.ts` would choke with "null value in
  column state" because no upstream step set the race-level metadata.
- **`src/lib/llm/curate.ts`** auto-repair: extracts `bill_id` references from
  `track_record_note` text via regex and rebuilds the
  `track_record_citations` array. Haiku reliably writes bill IDs inline in the
  note but inconsistently populates the citations field; we fix it server-
  side. Fabricated explicit citations still throw — whitelist-only.
- **`scripts/synthesize/flag_inconsistencies.ts`** negation guard: notes that
  explicitly deny contradiction ("no contradictory votes found", "no relevant
  record") no longer fire Check 2.

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
