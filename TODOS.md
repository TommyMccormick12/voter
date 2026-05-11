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

### Backfill Preview-scope Vercel env vars
- **Priority:** P3 (only matters when pushing non-`main` branches)
- **What:** Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `IP_HASH_SECRET`, `ANTHROPIC_API_KEY` in Vercel's Preview scope.
- **Why:** The CLI's `vercel env add KEY preview --value V --yes` hits an `action_required: git_branch_required` state even with `--yes` (Vercel CLI quirk for default branch). Production scope is fully set; Preview deploys will fail to read from Supabase until this lands.
- **How:** Vercel dashboard → Project Settings → Environment Variables → Add each one, scope = "Preview", apply to "All preview branches". ~2 minutes.
- **Acceptance:** Pushing a feature branch produces a Vercel preview URL that returns 200 on `/api/candidates?zip=32801` with real data.

### Custom domain
- **Priority:** P4 (cosmetic; launch readiness)
- **What:** Point a real domain at the Vercel project (currently on `voter-k4ewj9iy9-tommymccormick12s-projects.vercel.app`).
- **Why:** Shareable URLs read better with a real domain. Easier to put in Twitter/email/SMS.
- **How:** Buy/repurpose a domain, add it in Vercel Project Settings → Domains, follow DNS instructions.

## Completed

### Phase 1 — Pre-launch (superseded by pivot)
- **Superseded:** v0.2.0 (2026-05-09)
- The original `baseline_aggregates` Pew Research seed and "You vs community" share card belonged to the deleted issue-ranking flow. Sentiment data now flows through `quick_poll_responses` + `llm_matches` instead. The share card is per-candidate now ("Someone matched X — find yours"), not per-zip community percentile, so cold-start baseline data is no longer required.
- The Vercel Analytics TODO is also moot: Vercel is deployed (v0.6.0), and analytics flow through first-party `candidate_interactions` + `session_visits` tables instead of Vercel's bundled analytics product.
