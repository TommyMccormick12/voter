# TODOS

## Phase 1 — Pre-launch

### Seed national survey baseline data
- **Priority:** High (blocks share card "You vs. community" feature)
- **What:** Pre-load Pew Research issue priority survey data as national baseline for aggregate comparisons
- **Why:** First users in any zip need comparison data for the share card to show percentiles. Without baseline, cold-start renders the surprise element useless.
- **How:** Find Pew's most recent "issue importance" survey (published annually). Format as aggregate rankings. Insert into a `baseline_aggregates` table or as a special row in the aggregation query. Label in UI as "based on national surveys" until local data exceeds threshold.
- **Depends on:** 002 migration (RLS policies) deployed
- **Acceptance:** Every zip code returns a comparison result, even with zero local rankings

### Enable Vercel Analytics for qualitative traffic validation
- **Priority:** Medium (needed before distribution push)
- **What:** Enable Vercel Analytics (free tier) on the deployment to track referrer sources, geographic distribution, and unique visitor patterns
- **Why:** Since we chose qualitative validation over bot fingerprinting (eng review D12), we need referral data to distinguish real organic engagement from scripted submissions. This is how we verify Phase 1 success criteria represent real humans.
- **How:** Enable in Vercel dashboard (zero code). Optionally add `@vercel/analytics` package for custom events.
- **Depends on:** Vercel deployment
- **Acceptance:** Can see referral sources, geographic spread, and session counts in Vercel dashboard
