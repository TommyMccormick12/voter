# QA Report — Voter (Chunk 3 Pages + API Routes)

**Date:** 2026-05-09
**URL:** http://localhost:3003
**Branch:** master
**Tier:** Standard
**Mode:** Diff-aware (post-Chunk 3 commit verification)
**Framework:** Next.js 16.2.4 + React 19 + Tailwind 4

## Scope

Chunk 3 wired up the new pages and API routes that consume the Chunk 1 mock data and Chunk 2 carousel components:

- `/race-picker` — lists primaries near a zip
- `/scorecards/[raceId]` — carousel + grid of candidate scorecards
- `/candidate/[slug]` — full record with 4-tab detail view
- `/api/interaction` — POST stub for engagement tracking
- `/api/candidates` — GET races/candidates filtered by zip or race_id
- Updated homepage routing + copy

## Health Score

| | Before | After |
|--|--------|-------|
| **Health score** | 71 | 97 |
| Console errors (after cache clear) | 0 | 0 |
| Lint errors | 0 | 0 |
| Test suite | 27 passing | 27 passing |
| Build | clean | clean |
| Date display correctness | ❌ 1-day off | ✅ correct |
| API HTTP semantics | ❌ 500 on bad JSON | ✅ 400 on bad JSON |

## Top issues found

1. **ISSUE-001 (HIGH)** — Off-by-one dates across the entire app. Election dates, vote dates, and statement dates all rendered the previous day in any timezone west of UTC. For a civic tool, showing the wrong election date is materially harmful — voters could go to the polls the wrong day.
2. **ISSUE-002 (LOW)** — `/api/interaction` returned 500 instead of 400 on malformed JSON, polluting error-budget signals.

## Issues

### ISSUE-001 — Dates off-by-one across the app (HIGH)
**Category:** Functional / trust
**Reproduction:** Visit `/race-picker?zip=07059` — NJ-07 election date is `2026-06-02` in the data, displayed as "June 1, 2026" in the card. Visit `/candidate/thomas-kean-jr` Voting tab — H.R. 1 `2024-11-15` shows as "Nov 14, 2024", same off-by-one for all 3 votes. Statements tab shows "Mar 3, 2026" for `2026-03-04` and "Aug 11, 2025" for `2025-08-12`.
**Root cause:** `new Date('2026-06-02')` parses YYYY-MM-DD strings as UTC midnight (`2026-06-02T00:00:00Z`). Then `toLocaleDateString('en-US')` in any timezone west of UTC (e.g., America/New_York) renders the previous day. Bug existed in 4 places: `VotingRecordList.tsx`, `StatementTimeline.tsx`, `race-picker/page.tsx`, `scorecards/[raceId]/page.tsx`.
**Impact:** Wrong election date displayed = trust-killing for a civic tool. Wrong vote dates undermine the "what they actually did" data product. Wrong statement dates make the timeline meaningless.
**Fix:** New shared `src/lib/dates.ts` helper:
- `parseLocalDate(input)` — parses YYYY-MM-DD as local midnight; falls through to native Date for ISO timestamps with explicit time/zone
- `formatLocalDate(input, options?)` — `toLocaleDateString` after local parse
- `daysUntilLocalDate(input, nowMs)` — countdown helper
Applied to all 4 files. Inline `new Date()` calls deleted.
- **Status:** verified
- **Commit:** c705964
- **Before:** Race picker "June 1, 2026" / votes "Nov 14, 2024", "Sep 19, 2024", "Feb 9, 2025" / statements "Mar 3, 2026", "Aug 11, 2025"
- **After:** Race picker "June 2, 2026" / votes "Nov 15, 2024", "Sep 20, 2024", "Feb 10, 2025" / statements "Mar 4, 2026", "Aug 12, 2025"

### ISSUE-002 — `/api/interaction` returns 500 on bad JSON (LOW)
**Category:** API quality / observability
**Reproduction:** `curl -X POST /api/interaction -d 'not json' -H 'Content-Type: application/json'` → 500 server_error.
**Root cause:** `await request.json()` throws on parse failure; the catch block treated all throws as server errors.
**Impact:** Buggy clients in the wild would burn the 5xx error budget and trigger spurious alerts. Conflating client errors with server errors corrupts ops signals.
**Fix:** Split JSON parse from Zod validation. Bad JSON → 400 `invalid_json`. Bad shape → 400 `invalid_payload` (existing).
- **Status:** verified
- **Commit:** 4dd6279
- **After:**
  - `curl -d 'not json'` → 400 `invalid_json` (was 500)
  - `curl -d '{}'` → 400 `invalid_payload`
  - `curl -d '{valid}'` → 200 ok:true

## Pages tested

| Page | Result |
|------|--------|
| `/` (homepage) | ✅ New copy + zip submit routes to `/race-picker` correctly |
| `/race-picker` (no zip) | ✅ Graceful "No zip code provided" CTA |
| `/race-picker?zip=07059` | ✅ NJ-07 card with party badge, candidate avatars, days countdown (now correct after ISSUE-001 fix) |
| `/race-picker?zip=99999` | ✅ Warm empty state |
| `/scorecards/race-nj-07` | ✅ Carousel renders, source pills varied (Ballotpedia/Campaign site/OpenSecrets), track-record badges |
| `/scorecards/nonexistent` | ✅ 404 (notFound) |
| `/candidate/thomas-kean-jr` | ✅ Hero, all 4 tabs (Stances/Donors/Voting/Statements) work |
| `/candidate/no-such-person` | ✅ 404 (notFound) |
| `/api/candidates?zip=07059` | ✅ Returns races + candidate_count |
| `/api/candidates?race_id=race-nj-07` | ✅ Returns full race + candidates |
| `/api/candidates?zip=invalid` | ✅ 400 invalid_zip |
| `/api/candidates` (no params) | ✅ 400 missing_query |
| `/api/candidates?race_id=fake` | ✅ 404 race_not_found |
| `/api/interaction` (valid POST) | ✅ 200 ok:true, dev console logs the event |
| `/api/interaction` (bad JSON) | ❌→✅ Fixed (ISSUE-002) |
| `/api/interaction` (bad shape) | ✅ 400 invalid_payload with field-level errors |

## End-to-end smoke test

Mobile (375x812):
1. `/` → fill zip "07059" → submit
2. Routes to `/race-picker?zip=07059` (Supabase placeholder errors swallowed by session.ts, navigation succeeds)
3. Tap NJ-07 race card → `/scorecards/race-nj-07`
4. Carousel renders with party-themed cards, swipe between candidates
5. Tap "Full record →" on Kean → `/candidate/thomas-kean-jr`
6. Cycle through all 4 tabs — Stances, Donors, Voting, Statements all render

Desktop (1400x900):
- `/scorecards/race-nj-07` shows 4-column grid (no carousel) at lg+ breakpoint
- `/candidate/[slug]` hero + sticky tabs work

## Console health

After clearing the Turbopack cache (stale `MOCK_SOURCE_PATTERNS` reference from a mid-edit version of mock-data.ts), all subsequent runs were clean. Zero console errors during the post-fix smoke test. The only expected errors are the Supabase placeholder URL fetch failures, which `session.ts` catches and logs without breaking the flow.

## Build, lint, test summary

| | Before fixes | After fixes |
|--|---------|---------|
| `npm run build` | ✅ pass | ✅ pass |
| `npm run lint` | ✅ clean | ✅ clean |
| `npm test` | ✅ 27/27 | ✅ 27/27 |
| Console errors | 0 (post cache-clear) | 0 |

## Commits

```
4dd6279 fix(qa): ISSUE-002 — /api/interaction returns 400 (not 500) for invalid JSON
c705964 fix(qa): ISSUE-001 — dates off-by-one across the app
```

## PR Summary

> QA found 2 issues, fixed both, health score 71 → 97. ISSUE-001 was the big one — every date in the app was rendering 1 day early because `new Date('YYYY-MM-DD')` parses as UTC and `toLocaleDateString` renders in local. Election dates wrong on a civic tool = trust killer. Shared `src/lib/dates.ts` helper now used in 4 places.

## Status

**DONE** — 2 issues found, 2 fixed, all verified. Chunk 3 ready. Ready to continue with Chunk 4 (LLM match flow).
