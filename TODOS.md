# TODOS

## Data pipeline

### Hand-author 7 remaining empty races
- **Priority:** P2 (post-launch polish, not a blocker)
- **What:** Fill stances for the 7 races that currently show "Curating — check back soon": FL Gov R+D, FL-10 R, FL-13 D, FL-15 D, FL-27 D, FL-28 D.
- **Why:** Tier 1 R-side has full coverage (10 incumbents). D-side has 2 of 6 House races populated (Sen D via Grayson + Nixon). The remaining races have either no candidates with usable websites or no Wikipedia coverage. Carousel renders an honest empty state today, but every empty race is a missed voter touch point.
- **How:** For each race, pick 1-2 leading candidates, read their campaign-site issues page or recent news, author a `{slug, bio, key_messages[], campaign_themes[], website}` JSON and run `npm run ingest:author -- --race-id ... --file ...`. Then `synth:stances` → `review:activate` → `seed:candidates`. ~30 min per candidate, ~5 hours total.
- **Acceptance:** All 16 FL Tier 1 races have ≥ 1 active candidate with `top_stances`.

### Tier 2 House race ingestion
- **Priority:** P3 (expansion, post-engagement-signal)
- **What:** Extend ingest to the ~12 contested FL House primaries beyond Tier 1: FL-09, 11, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26 (both R and D where contested).
- **Why:** Plan §16.7. Tier 1 was the validation slice; Tier 2 is the scale-out. Pipeline runs unchanged — pure data work.
- **How:** Same per-race recipe documented in `scripts/README.md`. ~3-5 minutes wall-clock per race + ~30 minutes manual review. Budget ~$0.40 in Anthropic Haiku across all 12 races.
- **Depends on:** Engagement data from Tier 1 to confirm the carousel + match flow are worth scaling.

## Product polish

### Move rate limits to distributed store
- **Priority:** P3 (latent — only bites under sustained load)
- **What:** Swap `src/lib/rate-limit.ts` in-memory token buckets for Vercel KV or Upstash Redis.
- **Why:** Documented in `src/lib/rate-limit.ts:1-9`. In-memory buckets are per-Lambda; with cold-start instance multiplication, an attacker hitting concurrent sessions across warm workers could 5-10× the effective limit. Acceptable at launch volume; revisit on first abuse incident or when traffic ramps.
- **How:** The `checkBucket` / `checkRateLimits` interface stays identical — only the storage layer changes. ~1 hour with KV.
- **Acceptance:** Same rate-limit behavior, but counters survive across Lambda instances.

### Report-queue spam dedup
- **Priority:** P3 (defense-in-depth, watch-and-react)
- **What:** Add a `UNIQUE (ip_hash, candidate_id, description_hash)` constraint or app-layer hash check on `candidate_reports`, plus an `ip_hash` recent-count column on the admin dashboard.
- **Why:** `/cso` MED-3. Rate limits prevent volume from a single session/IP, but an organized actor with proxy rotation could still flood the admin queue with duplicate-text reports. Currently no signal in the dashboard for clustered submissions.
- **How:** Migration 010 adds the constraint; admin dashboard query joins on `ip_hash`-grouped counts. ~30 min.
- **Acceptance:** Reports from the same IP hash on the same candidate with similar text either deduplicate or surface as a cluster in the admin queue.

## Completed

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
