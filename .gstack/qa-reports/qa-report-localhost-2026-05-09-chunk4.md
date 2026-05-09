# QA Report — Voter (Chunk 4 LLM Match Flow)

**Date:** 2026-05-09
**URL:** http://localhost:3003
**Branch:** master
**Tier:** Standard
**Mode:** Diff-aware (post-Chunk 4 commit verification)
**Framework:** Next.js 16.2.4 + React 19 + Tailwind 4

## Scope

Chunk 4 wired up the LLM match flow:
- `/api/match` — Anthropic Haiku 4.5 with deterministic mock fallback when no API key
- `/api/quick-poll` — POST stub for the B2B sentiment data product
- `/match` — 2-step wizard (5-issue quick poll → free-text)
- `/match/results` — top match expanded card + ranked sidebar
- 3 new components: QuickPoll, FreeTextMatcher, MatchScoreBadge
- 1 new lib: src/lib/llm/match.ts

## Health Score

| | Before | After |
|--|--------|-------|
| **Health score** | 73 | 96 |
| Mock ranking accuracy | ❌ Romano 88% for any input | ✅ Reflects user priorities |
| API contract | ✅ already solid | ✅ verified |
| Build | clean | clean |
| Lint | clean | clean |
| Tests | 27/27 | 27/27 |

## Top issue found

**ISSUE-001 (HIGH)** — Mock fallback ranking ignored user priorities. The default weight of 3 for un-rated issues meant a candidate's strong stances on irrelevant topics still counted toward their score. Result: David Romano (hardline conservative on guns/immigration/education, with no climate or healthcare stance) scored 88% for a climate/healthcare-focused user. Same 88% for a healthcare-only user. Same 89% for a gun-rights user. Romano was the top match regardless of what the user said. **Misleading on a civic platform whose entire pitch is alignment-based matching.**

## Issues

### ISSUE-001 — Mock ranking gives Romano 88% regardless of user input (HIGH)
**Category:** Functional / trust
**Reproduction:** POST `/api/match` with `quick_poll: [{issue_slug: "climate", weight: 5}]` and climate-focused free text → Romano top at 88%. Same with healthcare → Romano 88%. Same with guns → Romano 89%. The ranking didn't change with user input.
**Root cause:** `src/lib/llm/match.ts` mock ranking used `weights.get(stance.issue_slug) ?? 3`. When user only weighted climate, Romano's stances on guns/immigration/education got default weight 3 each. Strong absolute stance values × default weight 3 = high score. Romano's stances are all strongly-held → he won every comparison.
**Impact:** Mock-mode ranking was effectively "candidate with strongest opinions wins" instead of "candidate whose stances cover the user's priorities wins." This is the wedge feature vs ISideWith — if it doesn't actually align, the product has no point in mock mode.
**Fix:** Rewrote `mockRank` to score only on stances matching user-priority issues. Stances on un-rated issues contribute 0. Score = coverage of user priorities, normalized by max possible (perfect strongly-held stance on every priority issue). No-signal fallback returns 50% with skip prompt.
- **Status:** verified
- **Commit:** cff2a10
- **Before:** Climate user → Romano 88%, healthcare user → Romano 88%, gun user → Romano 89% (ranking didn't change)
- **After:**
  - Climate-focused → Mehta 50%, Park 50%, Kean 0%, Romano 0%
  - Gun-rights focused → Romano 100%, Kean 50%, Mehta 0%, Park 0%
  - Border + taxes → Mehta 50%, Kean 33%, Romano 33%, Park 0%
  - Browser smoke: "lower taxes + border + Medicare" demo input → Mehta 39% top match (covers economy/climate/immigration but not healthcare → "partial alignment")

## Pages tested

| Surface | Result |
|---------|--------|
| `/match?race=race-nj-07` step 1 | ✅ 5 issues with star rows, tap-to-clear, Continue disabled until at least 1 rated |
| Continue → step 2 | ✅ Textarea + char counter + loading spinner + "Find my match" |
| Back from step 2 → step 1 | ✅ Poll responses preserved |
| `/match` no race param | ✅ Friendly empty state with homepage CTA |
| `/match?race=fake` | ✅ "Race not found" with homepage CTA |
| `/match/results?race=race-nj-07` (with sessionStorage) | ✅ Top match card + ranked sidebar + party theming |
| `/match/results` after sessionStorage clear | ✅ Empty state with "Start the match" CTA |
| `/match/results` page refresh | ✅ Results persist via sessionStorage |
| Demo-mode footer | ✅ Shows "⚠ Demo mode (no API key) — using local heuristic ranking" |

## API tested

| Call | Status |
|------|--------|
| `POST /api/match` valid | ✅ 200 with ranked + meta |
| `POST /api/match` cache hit (same input twice) | ✅ `meta.cache_hit: true, source: 'cache'` on second call |
| `POST /api/match` race_not_found | ✅ 404 |
| `POST /api/match` empty free_text | ✅ 400 invalid_payload |
| `POST /api/match` invalid JSON | ✅ 400 invalid_json |
| `POST /api/match` no quick_poll | ✅ 200, falls back to free-text mentions only |
| `POST /api/match` empty quick_poll array | ✅ 200, all 50% with prompt |
| `POST /api/quick-poll` valid | ✅ 200 ok:true, recorded: N |
| `POST /api/quick-poll` weight out of range | ✅ 400 with field-level error |
| `POST /api/quick-poll` empty responses | ✅ 400 (min length 1 enforced) |
| `POST /api/quick-poll` invalid JSON | ✅ 400 invalid_json |

## End-to-end smoke test

Mobile (375x812):
1. `/scorecards/race-nj-07` → "Find my best match →"
2. Routes to `/match?race=race-nj-07` step 1
3. Tap stars: economy=5, healthcare=4, immigration=2, climate=3, housing=5
4. Continue → step 2
5. Type "Lower taxes for working families and someone serious about the border, but who isn't going to gut Social Security or Medicare for older folks like my mom."
6. Find my match → `/match/results?race=race-nj-07`
7. Top match card: **Priya Mehta 39% partial alignment**, rationale "Closest alignment on economy, climate, immigration", 3 stance bullets
8. Ranked list below: Mehta 39%, then others
9. Demo-mode footer banner visible

## Console health

Zero JS errors during the smoke test. The only server-side errors during fix iteration were intentional (testing invalid JSON path). All API responses had correct HTTP status codes.

## Build, lint, test summary

| | Before fix | After fix |
|--|---------|---------|
| `npm run build` | ✅ pass | ✅ pass |
| `npm run lint` | ✅ clean | ✅ clean |
| `npm test` | ✅ 27/27 | ✅ 27/27 |

## Commits

```
cff2a10 fix(qa): ISSUE-001 — mock ranking ignored user priorities, gave Romano 88% regardless
```

## PR Summary

> QA found 1 high-severity issue, fixed it, health score 73 → 96. ISSUE-001: mock fallback ranking gave Romano 88% no matter what the user said. Re-architected to score only on user-priority issues. Now climate-focused users see Mehta and Park (the only candidates with climate stances), gun-rights users see Romano correctly at 100%, etc. Real LLM path (Haiku) was unaffected.

## Status

**DONE** — 1 issue found, 1 fixed, 0 deferred. Chunk 4 ready. Ready to continue with Chunk 5 (cookie + consent infrastructure) or set `ANTHROPIC_API_KEY` to test the real Haiku path.
