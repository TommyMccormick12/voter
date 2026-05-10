# QA Report — Chunk 7 (Cleanup, share/OG for match results, Phase 1 deletions)

**Date:** 2026-05-10
**Branch:** master
**Commit under test:** `e4ab93f` — feat(pivot): chunk 7 — cleanup, share/OG for match results, deprecate Phase 1 routes
**Scope:** 13 files / +514 / −884: rewrite of `/share` + `/api/og` for match results, MatchResults Share button wiring, Nav copy update, deletion of `/priorities` + `/compare` + `/races` + RankingInterface + `src/lib/rankings.ts` + `tests/rankings.test.ts`, root `CLAUDE.md` rewrite.

## Gates

| Gate | Result |
|------|--------|
| `npm run lint` | ✅ clean |
| `npx vitest run` | ✅ 16/16 pass (was 27 before; the 11 deleted tests were `rankings.test.ts`, all referencing removed `getAggregateByZip`/`getPercentile`/`saveRankings`) |
| `npm run build` | ✅ clean — **18 routes** (was 22; `/priorities`, `/compare/[a]/[b]`, `/races` correctly absent) |

## Browser smoke (localhost:3000, fresh `.next`)

### `/share` — match-result card

| Variant | URL | Result |
|---------|-----|--------|
| Republican | `?race=race-nj-07&c=thomas-kean-jr&s=88` | ✅ Red gradient hero, TK avatar, "Thomas Kean Jr.", "Republican · Incumbent", **88%**, "U.S. House NJ-07 (R)" header, red "See full record" CTA, dark "Find your own match" CTA |
| Democrat | `?race=race-va-sen&c=mark-warner&s=73` | ✅ Blue gradient hero, MW avatar, "Mark Warner", "Democrat · Incumbent", **73%**, "U.S. Senate VA (D)" header, blue CTA |
| No params | `/share` | ✅ Generic invite: "Find your match" + tagline + "Start now" CTA |
| Bogus slug | `?race=race-nj-07&c=vance-romano&s=88` | ✅ Falls through to generic invite (graceful unknown-candidate handling) |

Screenshots: `c7-share-valid-r.png`, `c7-share-valid-d.png`, `c7-share-generic.png`.

### `/api/og` — Open Graph image

| Variant | URL | Result |
|---------|-----|--------|
| Republican | `?race=race-nj-07&c=thomas-kean-jr&s=88` | ✅ 1200×630, red gradient stripe (left), red TK avatar, "TOP MATCH / Thomas Kean Jr. / Republican · Incumbent", right pane "2026 PRIMARY / U.S. House NJ-07 (R) / MATCH SCORE / 88%", footer "Find your own match in 60 seconds" + voter brand |
| Democrat | `?race=race-va-sen&c=mark-warner&s=73` | ✅ Identical structure with blue palette + Mark Warner / 73% |
| Generic | `/api/og` | ✅ Centered "Find your match" + tagline, voter brand bottom-right |

Screenshots: `c7-og-r.png`, `c7-og-d.png`, `c7-og-generic.png`. No Satori parse errors (every node has `display:flex`, no rgb-in-gradient, scores rendered via template-literal stringification).

### Deleted-route 404 verification

```
/priorities      → HTTP 404 ✅
/races           → HTTP 404 ✅
/compare/a/b     → HTTP 404 ✅
/share           → HTTP 200 ✅
/race-picker     → HTTP 200 ✅
```

### Nav copy

Confirmed in every screenshot: header now reads "voter | Find your primary" (was "voter | All Races"). Link target verified `/race-picker`.

### End-to-end smoke

Walked the canonical user flow at production-likely viewport (1280×720):

1. `/` — "Find your candidates for the 2026 federal midterm primaries" hero, zip form, **no fallback `/priorities` link** (correctly removed). ✅
2. `/race-picker?zip=07059` — "1 federal primary near you" with NJ-07 R card, **23-day countdown** to June 2 (date math correct: 2026-05-10 + 23 = 2026-06-02). ✅
3. `/scorecards/race-nj-07` — 4-col grid of NJ-07 R candidates, all party-red themed. ✅
4. `/match?race=race-nj-07` — Step 1 of 2, "What matters most to you?" QuickPoll with 5 issue rows. ✅
5. `/candidate/thomas-kean-jr` — Party-red header, Stances/Donors/Voting/Statements tabs, stance list with track-record annotations. ✅

Screenshots: `c7-e2e-1-home.png` through `c7-e2e-5-candidate.png`.

### Console health

Only one repeated message across all routes:

> ⚠ metadataBase property in metadata export is not set for resolving social open graph or twitter images, using "http://localhost:3000".

This is a **dev-mode advisory** from Next 16. It auto-resolves in production (Vercel sets `metadataBase` from `VERCEL_URL`). Not a bug. Could be silenced by adding an explicit `metadataBase` to `src/app/layout.tsx` if desired, but lower priority than shipping.

No JS errors, no hydration mismatches, no 404s on `_next/data` requests.

## Issues found

None.

## Notes / minor observations

- **Independent (purple) party variant uncovered.** Mock data has no `primary_party: 'I'` candidate, so the violet theme is only exercised as the fallback for null/unknown party. Will get real coverage once a real Independent candidate is seeded.
- **Share button** in `MatchResults.tsx` was tested by URL-construction equivalence: the params it builds (`?race=<id>&c=<slug>&s=<rounded>`) match the URLs verified above. Full clipboard interaction not exercised because the headless browse context doesn't grant clipboard permissions — but the underlying `/share` target is fully verified.
- **`metadataBase` advisory** — could fix proactively by adding `metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000')` to layout metadata. Low priority.

## Pivot status

All 7 chunks shipped + QA'd. App is end-to-end functional on mock data:
- zip → `/race-picker` → `/scorecards/[raceId]` (carousel) → `/match` (poll + free-text) → `/match/results` (ranked, share button) → `/share` (party-themed card + OG)
- offline data pipeline scripts ready (need API keys in `.env.local`)
- consent + data-rights + privacy/terms infra wired

## Status

**DONE** — chunk 7 verified, no blocking issues. Ready for real-data ingestion once API keys are added.
