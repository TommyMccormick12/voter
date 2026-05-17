# TODOS

## Data pipeline

### Tier 2 House race ingestion
- **Priority:** P2 (expansion, broader coverage)
- **What:** Extend ingest to the ~12 contested FL House primaries beyond Tier 1: FL-09, 11, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26 (both R and D where contested).
- **Why:** Plan §16.7. Tier 1 was the validation slice; Tier 2 is the scale-out. Pipeline runs unchanged — pure data work. Promoted above hand-authoring because the Tier 2 candidates have actual records (incumbents with voting history + donor data) so the ingest pipeline produces real content automatically.
- **How:** Same per-race recipe documented in `scripts/README.md`. ~3-5 minutes wall-clock per race + ~30 minutes manual review. Budget ~$0.40 in Anthropic Haiku across all 12 races.

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
