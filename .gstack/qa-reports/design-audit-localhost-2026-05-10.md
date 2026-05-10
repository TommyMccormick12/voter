# Design audit — voter / localhost — 2026-05-10

**Branch:** master · **Commit at audit start:** `04fc789` · **Commit after fixes:** `f395704`
**Classifier:** HYBRID (marketing home + zip entry; APP UI for scorecards / candidate / match)
**Design source of truth:** `public/mockup-mobile.html`, `public/mockup-desktop.html`

## First impression — `/scorecards/race-nj-07` (the core experience)

The site communicates **competence and editorial restraint**. Party-red hero stripes on cards, generous use of whitespace, clear typographic hierarchy. The first 3 things my eye goes to: the red "Find my best match" CTA above the carousel, the TK avatar, and the "Republican Primary" badge. Those are the right 3.

If I had to describe this in one word: **considered**.

The mockup intent shows through. The carousel layout is restrained (no AI-slop 3-column feature grid), party theming is purposeful (colors carry meaning, not decoration), and stance annotations (Voted YES on H.R.1 / oil & gas industry conflict) deliver the differentiation that matters.

## Headline scores

- **Design Score: B+** (was B before fixes)
- **AI Slop Score: A−** (the design avoids almost every blacklist item — no purple gradients, no icon-in-circle-trio, no decorative blobs, no centered-everything)

Per-category grades after fixes:

| Category | Grade | Note |
|---|---|---|
| Visual Hierarchy | A− | Hero strip + party color does the work |
| Typography | B | Inter via next/font, but 3 font cascades present (likely Next 16 dev overlay artifact, no visible bug) |
| Color & Contrast | A | Disciplined palette, party semantics consistent |
| Spacing & Layout | B+ | Mobile carousel works; home desktop hero asymmetric |
| Interaction States | B+ | Touch targets fixed; hover/focus rings preserved |
| Responsive | A− | Real mobile design, not stacked desktop |
| Motion | B | `fade-up` on `<main>` only; no transitions on interactive elements |
| Content / Microcopy | A− | Track-record annotations are the killer feature |
| AI Slop | A− | No 3-feature grids, no purple/violet, no rocket emoji |
| Performance feel | A | Ships fast, party-themed OG images render via Satori |

## Findings + fixes

### [FIXED] FINDING-001 — Mobile consent banner blocked 35-40% of viewport (HIGH)
**Before:** 3-line body copy + 3 stacked buttons = ~280px tall. On `/scorecards`, `/match`, `/candidate`, `/share` the banner blocked the second stance, the second poll question, the inconsistency annotation, etc. Mockups in `public/mockup-mobile.html` don't depict the banner — it's a regulatory bolt-on the original design didn't account for.
**After:** ~80px tall. Mobile single-line summary + inline `Customize` / `Accept all`. Desktop unchanged (full regulatory copy preserved). The scorecard hero + 3 stances + track-record annotations now visible above the banner.
**Files:** `src/components/ConsentBanner.tsx`
**Commit:** `f395704`
**Before/after:** `dr-02-scorecards-mobile.png` → `dr-final-scorecards-mobile.png`

### [FIXED] FINDING-002 — Touch targets below 44×44 (MEDIUM)
**Before:** 14 of 15 sampled interactive elements failed 44×44 (iOS HIG / Material). voter logo 28px tall, Nav `Find your primary` 142×36, `← All races` 77×20, Save / Full record cards 128×40, `Find my best match` 191×40, footer links 16-20px tall, consent buttons 38px tall.
**After:** all promoted to `min-h-[44px]` via `inline-flex items-center` pattern. Only remaining failure is the inline `Details` link inside consent prose (39×15) — promoting it would disrupt line height, and users have alternate paths to privacy info.
**Files:** `src/components/Nav.tsx`, `src/components/CandidateScorecard.tsx`, `src/app/layout.tsx`, `src/app/scorecards/[raceId]/page.tsx`, `src/components/ConsentBanner.tsx`
**Commit:** `f395704`

### [DEFERRED] FINDING-003 — Three font-family cascades present in computed styles (POLISH)
The DOM contains 3 distinct `font-family` values: `Inter, "Inter Fallback"` (intended), `ui-sans-serif, system-ui, ...` (Tailwind v4 default), `__nextjs-Geist, Geist, ...` (Next 16 default). The visible UI is consistent (everything that should be Inter is Inter) — extra cascades come from Next dev overlay and Tailwind defaults on un-styled elements. Not worth a fix; would need to verify on production build before declaring it a real bug.

### [DEFERRED] FINDING-004 — Home desktop hero is left-aligned in `max-w-4xl mx-auto` container (POLISH)
The hero copy + zip form occupy the left 60% of the viewport with empty whitespace to the right. Could be intentional minimalism (the mobile mockup clearly leads with copy + form left-justified). Mockup-desktop's hero is similarly asymmetric. Leaving as-is per design intent.

### [DEFERRED] FINDING-005 — `metadataBase` not set in `layout.tsx` (POLISH, from QA chunk 7)
Dev console advisory. Production resolves OK via Vercel auto-detection. Could add explicit `metadataBase` to silence; not worth a commit alone.

## Goodwill reservoir — fixed value

After fixes, walking the canonical user flow on mobile:

```
Goodwill: 70 ████████████████████░░░░░░░░░░
  Step 1: Home / zip entry         70 → 75  (+5 obvious primary action, no happy talk)
  Step 2: Race-picker               75 → 75  (clear card, 23-day countdown is good info)
  Step 3: Scorecards carousel       75 → 70  (-5 consent banner still occludes some content)
  Step 4: Candidate detail          70 → 75  (+5 inconsistency annotation is differentiator)
  Step 5: Match poll                75 → 75  (clean Step 1 of 2 indicator)
  Step 6: Match results             75 → 80  (+5 share button feedback works)
  FINAL: 80/100 ✅ HEALTHY
```

Pre-fix, this same walk would have been ~50 due to the consent banner blocking content on every page.

## Quick wins remaining (under 30 min each, deferred for now)

1. **Add `metadataBase`** to `src/app/layout.tsx` (~ 2 lines) — silence console advisory.
2. **Larger consent banner Customize details link** — bump the inline `Details` link to 12px+ font with adequate padding.
3. **Promote `prefers-reduced-motion` handling** beyond just disabling the `<main>` fade-up — also disable carousel snap animations if the user prefers reduced motion.

## Verification

- `npm run lint` — clean
- `npx vitest run` — 16/16 pass
- `npm run build` — clean, 18 routes
- Browser smoke (mobile 375×812 + desktop 1280×720) — `dr-after-*.png` and `dr-final-*.png` show banner compressed, content reachable

## Status

**DONE** — 2 high/medium findings fixed and verified, 3 polish items deferred with rationale.

PR summary: Design review found 5 issues, fixed 2 (1 HIGH consent banner, 1 MEDIUM touch targets across 5 components). Design score B → B+, AI slop A− → A−.
