# QA Report — Voter (Chunk 1+2 Pivot Verification)

**Date:** 2026-05-09
**URL:** http://localhost:3003
**Branch:** master
**Tier:** Standard
**Mode:** Diff-aware (post-Chunk 2 commit verification)
**Framework:** Next.js 16.2.4 + React 19 + Tailwind 4

## Scope

The pivot is mid-build. Chunks 1 (schema/types/mock data) + 2 (carousel UI components) are committed but not yet wired into pages (Chunk 3 work). QA scope:

1. **Regression check** — Phase 1 pages (homepage, /races, /priorities, /share, /api/og) still work after schema and type changes
2. **Mockup verification** — design source-of-truth files render correctly
3. **Build/test/lint health** — automated checks

## Health Score

| | Before | After |
|--|--------|-------|
| **Health score** | 64 | 96 |
| Console errors | 0 (live pages) | 0 |
| Lint errors | 3 | 0 |
| Lint warnings | 2 | 0 |
| Test suite | 27 passing | 27 passing |
| Build | clean | clean |
| OG endpoint with rankings | ❌ 500 | ✅ 200 |

## Top 3 things found

1. **ISSUE-001 (HIGH)** — OG image generation crashed for every share URL with rankings. Satori parsed `{index + 1}.` as two children (expression + literal text), requiring `display: flex` on the parent div. Empty rankings worked (single-child fallback). Every social share preview was broken.
2. **ISSUE-002 (HIGH)** — Three `<a href="/">` instead of `<Link>` causing full page reloads on internal navigation. Slower SPA UX.
3. **ISSUE-003 (LOW)** — Two unused type imports (`Issue`, `Candidate`) creating lint noise.

## Issues

### ISSUE-001 — OG image generation fails for share URLs with rankings (HIGH)
**Category:** Functional
**Reproduction:** `curl 'http://localhost:3003/api/og?r=economy'` → 500 with edge runtime error: `Expected <div> to have explicit "display: flex", "display: contents", or "display: none" if it has more than one child node.`
**Root cause:** `src/app/api/og/route.tsx:142` — JSX `{index + 1}.` is parsed by Satori as two children. Satori requires `display: flex` on parents with multiple children.
**Impact:** Every `/share?r=...` URL has broken `og:image` previews. Social sharing flow silently fails for the actual use case (the empty case worked, masking the bug).
**Fix:** Combine into single template literal `` `${index + 1}.` `` and add `display: flex` to the index div.
- **Status:** verified
- **Commit:** bae74a0
- **Before:** `curl 'http://localhost:3003/api/og?r=economy'` → 500
- **After:** `curl 'http://localhost:3003/api/og?r=economy,healthcare,immigration&zip=07059&p=73'` → 200, 27KB PNG (screenshot saved at `screenshots/issue-001-after.png`)

### ISSUE-002 — `<a>` instead of `<Link>` causes full page reloads (HIGH)
**Category:** Performance / UX
**Reproduction:** `npm run lint` reports 3 instances of `@next/next/no-html-link-for-pages`.
**Files:**
- `src/app/races/page.tsx:24` — homepage link in empty state
- `src/app/share/page.tsx:60` — Rank-your-priorities CTA (no rankings case)
- `src/app/share/page.tsx:110` — Rank-your-priorities CTA (with rankings)
**Impact:** Each click reloads the full page instead of using SPA navigation. Slower, loses scroll position, re-runs all client-side init.
**Fix:** Import `Link` from `next/link`, replace each `<a>` with `<Link>`.
- **Status:** verified
- **Commit:** 86fcbba
- **After:** Lint reports 0 errors.

### ISSUE-003 — Unused type imports (LOW)
**Category:** Code quality
**Files:**
- `src/components/RankingInterface.tsx:5` — `Issue` imported but never used
- `src/lib/mock-data.ts:7` — `Candidate` imported but never used (`CandidateWithFullData` extends it)
**Fix:** Remove from import lists.
- **Status:** verified
- **Commit:** aa7687b

## Pages tested (regression check)

| Page | Result |
|------|--------|
| `/` (homepage) | ✅ Renders, zip form works, no console errors. Still using Phase 1 copy + routing to `/priorities` (expected — Chunk 3 not yet done). |
| `/races` | ✅ Empty state renders cleanly with link back to homepage. |
| `/share?r=...&zip=...&p=...` | ✅ Renders shared rankings card, percentile callout, CTA. |
| `/api/og` (no params) | ✅ 200, generic card |
| `/api/og?r=economy,...` | ❌→✅ Fixed (ISSUE-001) |
| `/mockup-mobile.html` | ✅ Carousel scorecards render with party theming, badges, source pills, pagination dots. Tab switcher works. |
| `/mockup-desktop.html` | ✅ 4-col grid layout renders, party-colored cards, all 4 candidates shown. |

## Console health

Zero JS errors across all pages. The `[31m500[39m in ...ms` errors in dev server logs were the OG endpoint crashes (now fixed).

## Build, lint, test summary

| | Before fixes | After fixes |
|--|---------|---------|
| `npm run build` | ✅ pass | ✅ pass |
| `npm run lint` | ❌ 3 errors, 2 warnings | ✅ clean |
| `npm test` | ✅ 27/27 | ✅ 27/27 |
| `/api/og?r=...` | ❌ 500 | ✅ 200 PNG |

## Commits

```
aa7687b fix(qa): ISSUE-003 — remove 2 unused type imports
86fcbba fix(qa): ISSUE-002 — replace <a href> with <Link> for client-side routing
bae74a0 fix(qa): ISSUE-001 — OG image generation crashed on share URLs with rankings
```

## PR Summary

> QA found 3 issues, fixed 3, health score 64 → 96. OG image generation fixed for share URLs with rankings (Satori children-count bug). Lint suite cleaned (0 errors / 0 warnings). All 27 tests still pass. Phase 1 pages and mockup files render correctly post-Chunk 1+2.

## Notes

- No regressions detected from the schema migration (sessions/candidates ALTER TABLE only adds columns; existing queries unaffected).
- The `candidate_swipes` → `candidate_interactions` rename only affects the (not-yet-deployed) database; nothing in the live pages references it.
- The components built in Chunk 2 are not yet rendered by any route — they'll be exercised when Chunk 3 wires up `/scorecards/[raceId]`, `/candidate/[slug]`, and `/race-picker`.

## Status

**DONE** — 3 issues found, 3 fixed, all verified. Ready to continue with Chunk 3.
