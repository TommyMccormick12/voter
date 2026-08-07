# TODOS

> **SUPERSEDED 2026-08-06 (evening):** The rework ran on branch
> `rework/2026-08-06`. `SPEC-2026-08-06.md` and `TICKETS-2026-08-06.md` are
> the current record; items below are historical input to that spec. Do not
> execute items from this file. Still-open work lives in the tickets file
> (reseed steps, migration 012 approval) and the stance-authoring follow-up.
> The P4 hand-authoring item below also predates Decision 8 — no Governor
> races exist; only federal races may be authored.

> **2026-08-06 note:** The FL primary is August 18 — 12 days out. The two data-pipeline items below were deprioritized "until closer to August"; that window is now. Both are due alongside the rework items added from the 2026-08-06 repo review (see "Rework — 2026-08-06 repo review" section).
>
> **2026-08-06 data audit:** A 13-agent accuracy audit found the live dataset materially wrong about the August 18 ballot (23 of 24 verified findings CONFIRMED). Full evidence and code locations: `DATA-AUDIT-2026-08-06.md`. The section below supersedes normal priorities — P0 items outrank everything else in this file.
>
> **Planning documents for the rework:** `DECISIONS-2026-08-06.md` (13 settled decisions — to-spec inherits these), `DATA-SOURCES-2026-08-06.md` (replacement source stack), `../AGENT-ORCHESTRATION.md` (delegation + verification gates). Next step: run `/to-spec` against these plus this file.

## Data accuracy — 2026-08-06 audit (P0)

### Deactivate confirmed-wrong live candidates
- **Priority:** P0 — voters see false ballot facts today; data-only change, no code required
- **What:** Set `active=false` and reseed for candidates confirmed not on the 2026-08-18 ballot: marco-rubio (Secretary of State since Jan 2025), rick-sen-scott (seat not up until 2030), byron-donalds (running for Governor), vernon-buchanan (retired Jan 2026), daniel-webster (retired Apr 2026), anthony-sabatini (withdrew at qualifying), alan-mark-grayson (failed to qualify; running FL-7).
- **Also:** Races left empty or wrong by these removals show the honest "Curating" state until rebuilt — that is better than false data. race-fl-10-d gets the informational no-primary state per DECISIONS-2026-08-06.md #9 ("qualified unopposed and advances", scorecard still viewable) — interim "Curating" is acceptable until that state exists.
- **Note:** This item is executable immediately and independently of the rework — it needs only fixture edits + reseed once the service-role key is available. Every day it waits, voters see false ballot facts.

### Rebuild the roster from the certified qualified-candidate list on the 2026 map
- **Priority:** P0
- **What:** The entire race structure uses Florida's pre-2026 congressional map; the Aug 18 primary runs on the mid-decade map signed 2026-05-04 (upheld 2026-06-10). Rebuild races and candidate assignment from the FL Division of Elections qualified-candidate download (`dos.elections.myflorida.com/candidates/downloadcanlist.asp`, tab-delimited, status=Qualified — the ground truth for who is on the ballot), not FEC registrations. Real contests currently absent entirely (e.g. FL-11 R: Carey Baker vs Joe Strada) come in with this rebuild. See DATA-SOURCES-2026-08-06.md §1.
- **Acceptance:** Every active candidate appears on the state's qualified list for exactly that race; no race shows a candidate the state does not list; incumbent flags are unique per race.

### Drop Governor races; make scope genuinely federal-only
- **Priority:** P1 (decided — DECISIONS-2026-08-06.md #8)
- **What:** Delete the two empty `race-fl-gov-*-2026` fixtures and any gov race rows; fix the self-contradicting docs (README says "federal only", CLAUDE.md says "House, Senate, Governor"). No Governor surface ships.

### Rebuild district routing on the 2026 map (address-based)
- **Priority:** P0
- **What:** `supabase/seed/zip-districts.json` is a hand-mapped sample from 2022 maps (its own `_note` says so), not the HUD crosswalk the docs claim. Confirmed misroutes even on the old map (33142 → FL-26, actually 71% FL-24; 32822 → FL-09, actually 67% FL-10).
- **How (per DECISIONS-2026-08-06.md #3-4 — note: HUD and Census district products still serve the OLD map, so no ZIP file can be bought or downloaded):** self-hosted point-in-polygon on the official EOGPCRP2026 shapefile (flsenate.gov → GeoJSON, 28 polygons) with the free Census geocoder for address→lat/lon. ZIP-first UX: precompute ZIP→district(s) by intersecting Census ZCTAs with the new shapefile; single-district ZIPs answer directly; split ZIPs ask for a street address, which is geocoded and immediately discarded (store only ZIP + resolved district).

### Fix the four ingest bug classes
- **Priority:** P1 — before any re-ingest run
- **What:** (1) Title leakage in names/slugs — `src/lib/api-clients/names.ts` + `fetch_fec.ts` ("Rick Sen Scott", "Scott Mr. Franklin", 33 more on inactive rows). (2) Wikipedia wrong-person resolution — `fetch_platform.ts`/`wikipedia.ts` (FL-11 Webster carries the 1782–1852 statesman's bio); add sanity checks (death date present, birth year vs candidacy). (3) Member matching by ID, not name — `govtrack.ts` `matchRoleByName` initial-matching bug gave Royal Webster the congressman's govtrack_id and a vote he never cast; use bioguide/FEC IDs and district. (4) FEC attachment by candidate ID, not bidirectional substring name match — caused duplicate people under two FEC IDs (Joshua Weil $0 + $15.9M rows in one race).
- **Also in scope:** dedupe byte-identical fixture rows (4 files), resolve the 5 slugs that appear in two races, eliminate `vote-undefined` bill ids and the 89 contradictory YEA+NAY pairs, fix truncated bill titles.

### Make silent failures loud; add a freshness gate
- **Priority:** P1
- **What:** `seed_candidates.ts` delete-then-warn-and-continue can leave a live candidate with emptied child records — make child-insert failure abort the candidate's seed. Enforce the documented ≥3-stances threshold at activation (7 of 20 live candidates violate it today). Add `verified_at` to candidates: rows older than N days cannot stay `active` without re-verification, and the activation gate must include a candidacy-status check (withdrawal, retirement, office change, redistricting) against current news/state sources — an FEC filing is not proof of candidacy.
- **Money freshness:** re-pull FEC totals at rebuild (Vindman shows $8.2M, actual ~$16.7M; Nixon's $294K matches no filing; Scott/Grayson carry prior-cycle money).

## Rework — 2026-08-06 repo review

All items below come from a full repo review on 2026-08-06. Target: complete before the August 18 primary. Standards live in the parent Ballot Match project (`frontend-standards`, `backend-standards`, `data-and-release` skills).

### Decided constraints (2026-08-06)

Every rework ticket inherits these decisions. Do not re-litigate them per ticket.

1. **Errors surface; reads never fake success.** Data reads return typed results and the UI shows the five states (loading / success / empty / filtered-empty / error). One sanctioned exception: `/api/match` keeps its heuristic fallback for availability, but the UI must label fallback results as "estimated match" using the existing `source: 'mock'` meta — never present them as LLM output.
2. **One session identity.** The middleware `voter_session` httpOnly cookie is the only mechanism. Delete the legacy localStorage path in `src/lib/session.ts`.
3. **Design source of truth is code.** One token/palette module feeds Tailwind, components, and `/api/og`. Retire `public/mockup-*.html` and the hand-duplicated OG palette.
4. **All writes follow the layer flow.** Handler → application module → data adapter, including `/api/report` and `/admin` reads. Exactly one anon adapter and one service-role adapter; no inline Supabase clients.
5. **Typed data at one boundary.** Generate Supabase types; convert database names to application names in one boundary module. No raw snake_case rows in components.
6. **Match results travel by URL/server state,** not `sessionStorage` — `/match/results` must survive refresh and deep-linking.
7. **One rulebook.** The repo `CLAUDE.md` skill-routing section gets rewritten to point at the Ballot Match standards skills (`frontend-standards`, `backend-standards`, `data-and-release`) and the mattpocock process skills (`to-spec`, `to-tickets`, `implement`, `tdd`, `code-review`, `diagnosing-bugs`, `triage`). Remove routing to skills that do not exist.

### Wire the stub write endpoints to Supabase
- **Priority:** P1 — the engagement data that funds the product is not being collected
- **What:** `/api/interaction`, `/api/quick-poll`, and `/api/visit` are console-log / in-memory stubs. The tables (`candidate_interactions`, `quick_poll_responses`, `session_visits`) exist and have RLS INSERT policies. Also persist match results to `llm_matches` — the cache table exists, `/api/match` never writes it, yet `/admin` queries it for spend stats.
- **How:** Route handler → application module → data adapter, per `backend-standards`. Keep consent gating and rate limits as-is.
- **Acceptance:** A consented session produces rows in all four tables; `/admin` counts are non-zero; `/api/data-rights` export/delete reads real rows instead of in-memory stores.

### Surface real error states
- **Priority:** P1
- **What:** `src/lib/data/races.ts` and `data/candidates.ts` swallow Supabase errors and return `[]`, so a DB outage renders as "No candidates yet". There are zero `loading.tsx` / `error.tsx` files in `src/app`.
- **How:** Return typed results from the data layer; add `error.tsx` and `loading.tsx` per route; every data surface shows the five states (loading / success / empty / filtered-empty / error) per `frontend-standards`.

### Frontend rework against Ballot Match standards
- **Priority:** P1 — biggest product-quality lever
- **What:** Rebuild the UI layer to `frontend-standards`: design tokens beyond `party-theme.ts`, shared primitives instead of the flat component pile, form/table/accessibility rules, responsive rules. Route map stays; keep the carousel-not-Tinder interaction model. Retire `public/mockup-*.html` as design source of truth.
- **What also:** Wire or remove the inert Save/Share buttons on `/candidate/[slug]`.

### Consolidate session identity
- **Priority:** P2
- **What:** Two parallel session mechanisms exist: the middleware `voter_session` httpOnly cookie (current) and a legacy client-side `localStorage` token in `src/lib/session.ts` that inserts into `sessions` with the anon key. Collapse to the cookie path; delete the legacy path.

### Add CI
- **Priority:** P2
- **What:** No `.github/` workflows exist; lint/types only run inside Vercel builds, and `scripts/**` is excluded from the root tsconfig with no `typecheck` script anywhere — the whole pipeline is type-checked by nothing.
- **How:** GitHub Actions on PR + main: lint, `tsc --noEmit` for `src` and `scripts` (add a `typecheck` script), `vitest run`, `next build`.

### Widen test coverage
- **Priority:** P2
- **What:** Six unit suites exist (rate limits, IP hashing, GovTrack name matching, FEC names, session, events) but nothing tests API routes, the match flow, the citation validator in `curate.ts`, consent, or any component. Testing Library + jsdom are already installed.
- **How:** Select tests from risk per `data-and-release`: contract tests for `/api/match` and `/api/report`, unit tests for `matchCandidates` mock path and `extractJson`/whitelist, component tests for the match wizard states.

### Fix env and doc drift
- **Priority:** P3
- **What:** `.env.example` is missing `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and `NEXT_PUBLIC_SITE_URL` (all read by code). `CLAUDE.md` documents `FOLLOWTHEMONEY_API_KEY`, which no source file reads. `CLAUDE.md`'s skill-routing section references skills that do not exist in this environment — replace with the Ballot Match skill set.

### Repo cleanup
- **Priority:** P3
- **What:** `.gitignore` lists `.gstack/` but 42 files under it are already tracked — untrack them (keep locally). Remove unused Next scaffold SVGs in `public/`, `voter-mockups.zip`, and phase-1 leftovers (`engagement_events`, `issue_rankings`, `candidate_comparisons` code paths and, where safe, tables). Separate destructive DB cleanup from the code change per `data-and-release`.

## Data pipeline

### Tier 2 House race ingestion — finish the long tail
- **Priority:** P3 (most challengers lack public info until closer to August primaries)
- **What:** Bring up the remaining Tier 2 House races where ingest yielded insufficient data on 2026-05-17.
- **Progress:** 2026-05-17 batch ingested all 22 Tier 2 fixtures (~$0.40 Haiku). Yield: 2 new incumbents activated (DWS in FL-25 D, Diaz-Balart in FL-26 R). 90 candidates total across the 22 fixtures — only 3 met the ≥3-stances synthesis threshold, and 1 of those was already active (Sabatini). Root cause: most non-incumbent FL House challengers have no Wikipedia page and no usable campaign-site issues page this early in the cycle. Same finding as hand-authoring (P4 below).
- **What's still pending:** R-side challenger coverage in FL-09, 17, 20, 21, 22, 25, 26; nearly all D-side challenger fields.
- **Why deprioritized:** Re-running the same pipeline today won't yield more — Wikipedia and campaign sites are the bottleneck, not the pipeline. Worth re-running closer to August once press coverage and campaign launches accumulate. Pair with the P4 hand-authoring sweep.
- **How:** `/tmp/tier2-ingest.sh` recipe documented in `scripts/README.md`. Review docs from the 2026-05-17 batch live under `supabase/seed/review/race-fl-*-2026/` and can be re-used as starting points if data improves.

### Hand-author 7 remaining empty races
- **Priority:** P4 (revisit closer to primary dates — August 18, 2026)
- **What:** Fill stances for the 7 races that currently show "Curating — check back soon": FL Gov R+D, FL-10 R, FL-13 D, FL-15 D, FL-27 D, FL-28 D.
- **Why:** Tier 1 R-side has full coverage (10 incumbents). D-side has 2 of 6 House races populated (Sen D via Grayson + Nixon). The remaining races have either no candidates with usable websites or no Wikipedia coverage today.
- **Deprioritized 2026-05-17:** Most of these candidates have minimal public information available right now. Pushing to ~July when campaign sites/news coverage ramps closer to the August 18 primary. Until then, the empty state ("Curating — check back soon") is honest and not actively misleading.
- **How:** For each race, pick 1-2 leading candidates, read their campaign-site issues page or recent news, author a `{slug, bio, key_messages[], campaign_themes[], website}` JSON and run `npm run ingest:author -- --race-id ... --file ...`. Then `synth:stances` → `review:activate` → `seed:candidates`. ~30 min per candidate, ~5 hours total.
- **Acceptance:** All 16 FL Tier 1 races have ≥ 1 active candidate with `top_stances`.

## Product polish

_(no active items)_

## Completed

### Move rate limits to distributed store
- **Completed:** v0.8.0 (2026-05-17)
- Swapped `src/lib/rate-limit.ts` in-memory token buckets for Upstash Redis sliding-window via `@upstash/ratelimit` (Vercel Marketplace integration). Same `checkRateLimits` interface; signature is now async. All 6 API route callers (`match`, `report`, `interaction`, `visit`, `quick-poll`, `consent`) updated to `await`.
- Falls back silently to in-memory token bucket when `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` env vars are missing. Local dev and CI keep working without Redis; production picks up distributed storage automatically once Upstash is provisioned via Vercel Marketplace.
- **Action remaining:** Provision Upstash Redis in Vercel Marketplace (one-click, free tier covers ~50K sessions/month). Env vars auto-populate.

### Report-queue spam dedup
- **Completed:** v0.8.0 (2026-05-17)
- Migration 010 (`supabase/migrations/010_report_spam_dedup.sql`) adds a `description_hash` column to `candidate_reports`, backfills existing rows, and creates a partial `UNIQUE (ip_hash, candidate_id, description_hash) WHERE ip_hash IS NOT NULL AND description_hash IS NOT NULL` index.
- `/api/report` computes the hash with `crypto.subtle.digest('SHA-256', lower(trim(description)))` — identical normalization to the SQL backfill. On unique-violation (Postgres 23505) the API returns `200 { ok: true, deduplicated: true }` silently — the spammer doesn't learn dedup fired.
- Admin dashboard (`src/app/admin/page.tsx`) now has a "Suspicious IP clusters (7d, ≥3 reports)" section showing `ip_hash` prefix, report count, and distinct candidates targeted — catches the next step up where a spammer rotates description text but stays on one IP.

### Custom domain

### Custom domain
- **Completed:** v0.7.1 (2026-05-17)
- Pointed `ballotmatch.org` at the Vercel project. Old alias `voter-fawn.vercel.app` 308-redirects to the new primary domain.
- Added `metadataBase` to `src/app/layout.tsx` so OG/Twitter image URLs resolve against the stable domain instead of per-deploy `VERCEL_URL`. Fallback: `NEXT_PUBLIC_SITE_URL` env var if set (for preview-scope override).

### Backfill Preview-scope Vercel env vars
- **Completed:** v0.7.0 (2026-05-11)
- Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `IP_HASH_SECRET`, `ANTHROPIC_API_KEY`, `ADMIN_PASSWORD` in Vercel Preview scope via dashboard (CLI's `--git-branch main` flag was the workaround that didn't take; dashboard edit was cleaner).
- Pushing a feature branch now produces a working Vercel preview URL with full Supabase + admin functionality.

### Phase 1 — Pre-launch (superseded by pivot)
- **Superseded:** v0.2.0 (2026-05-09)
- The original `baseline_aggregates` Pew Research seed and "You vs community" share card belonged to the deleted issue-ranking flow. Sentiment data now flows through `quick_poll_responses` + `llm_matches` instead. The share card is per-candidate now ("Someone matched X — find yours"), not per-zip community percentile, so cold-start baseline data is no longer required.
- The Vercel Analytics TODO is also moot: Vercel is deployed (v0.6.0), and analytics flow through first-party `candidate_interactions` + `session_visits` tables instead of Vercel's bundled analytics product.
