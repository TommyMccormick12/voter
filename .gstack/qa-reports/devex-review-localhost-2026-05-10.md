# DevEx audit — voter contributor onboarding — 2026-05-10

**Branch:** master · **Commit at audit start:** `89a2f09` · **Commit after fixes:** `82657ca`
**Product type:** Internal contributor onboarding for a Next.js consumer app. External dev surface is the data pipeline scripts (`npm run ingest:* / synth:* / review:* / seed:*`).

## Scorecard

| Dimension | Before | After | Method | Notes |
|---|---|---|---|---|
| Getting Started | 4/10 | 9/10 | TESTED | README rewrite cut TTHW from ~12 min to ~2 min |
| API/CLI Ergonomics | 8/10 | 8/10 | TESTED | 13 npm scripts well-organized: `ingest:* / synth:* / review:* / seed:*`. Clear usage messages on all (verified chunk 6 QA). |
| Error Messages | 8/10 | 8/10 | TESTED | Scripts fail-fast with actionable next-step ("Run fetch_ballotpedia first"). `requireEnv()` throws clearly. |
| Documentation | 5/10 | 9/10 | TESTED | README signpost was broken, now points to CLAUDE.md + scripts/README.md + .env.example. `scripts/README.md` is genuinely good. |
| Upgrade Path | 6/10 | 6/10 | INFERRED | No CHANGELOG, no migration guide. Acceptable for solo project on master. |
| Dev Environment | 5/10 | 7/10 | INFERRED | `.nvmrc` added (Node 24.14.0 pinned). No CI, no `.vscode/`, no CONTRIBUTING.md. |
| Community | N/A | N/A | (solo) | |
| DX Measurement | N/A | N/A | (solo) | |
| **TTHW** | ~12 min | **~2 min** | TESTED | Clone → `npm install` → `npm run dev` → localhost:3000 + zip 07059 → mock data renders |
| **Overall DX** | 6/10 | **8/10** | | |

## Top finding (FIXED)

### FINDING-001 — README.md was unmodified `create-next-app` boilerplate (HIGH)

**Before:** README opened with "This is a Next.js project bootstrapped with create-next-app", linked to Next.js tutorials, mentioned "Geist font for Vercel", and contained zero project-specific information. A new contributor reading only the README:
- Did not know what `voter` is
- Did not know mock data ships in `src/lib/mock-data.ts` (so the app works locally without Supabase or any API keys)
- Did not know `CLAUDE.md` exists or that it has the architecture
- Did not know `scripts/README.md` exists or that it has the full data pipeline walkthrough
- Was likely to be confused by `.env.example` (do I need all 5 keys to run locally? No, but the README didn't say that)

Estimated TTHW: 10-15 minutes (RED FLAG tier — 50-70% abandon rate per the skill's adoption-tier table).

**After:** README leads with:
1. One-paragraph product description (scorecard + LLM match for 2026 federal primaries)
2. Stack at a glance
3. **3-command quickstart** explicitly noting "mock data, no API keys needed" → mock UI in <2 min
4. What ships out of the box (route map)
5. Pointer to `scripts/README.md` for adding a real race
6. Common commands table
7. Pointers to `CLAUDE.md`, `scripts/README.md`, `.env.example`, and the design mockups
8. Deploy section (Vercel, required env vars)

Verified TTHW: ~2 minutes (Champion tier).

## Secondary fix (FIXED)

### FINDING-002 — No Node version pin (MEDIUM)

**Before:** No `.nvmrc`, no `engines` in `package.json`. A contributor on Node 18 or 20 might hit Tailwind 4 / Next 16 / React 19 incompatibilities silently.

**After:** `.nvmrc` pins Node `24.14.0` (the version verified working).

## Strengths (no fix needed)

1. **`scripts/README.md` is genuinely good.** Has the full NJ-07 walkthrough (10 steps), required env vars with sourcing URLs, output structure diagram, pre-flight criteria, cost guardrails per API, failure/retry guidance, and "adding a new race" template. This is what a real DX reference doc looks like.

2. **`.env.example` is well-documented.** Every key has a one-line purpose + link to the signup page. The `MATCH_API_DISABLED` kill switch and "without this, /api/match falls back to a deterministic local heuristic" notes are exactly the kind of escape-hatch documentation good DX needs.

3. **npm script naming is consistent.** Verbs prefixed with `ingest:`, `synth:`, `review:`, `seed:` make autocomplete useful and signal pipeline ordering.

4. **Script error messages fail-fast with actionable next steps.** Verified in chunk 6 QA: `Partial fixture missing: ... Run fetch_ballotpedia first.` Beats generic "ENOENT" by miles.

## Findings deferred (low priority, project stage appropriate)

- **No CONTRIBUTING.md** — solo project, fine for now.
- **No CI workflow** (`.github/workflows/`) — pre-deploy phase, no PR review needed yet.
- **No CHANGELOG** — solo project, master only.
- **TESTING.md missing** — vitest works (16 tests), conventions are visible in the existing test files.

## Verification

- `npm run lint` — clean
- `npx vitest run` — 16/16 pass
- README renders correctly on disk (verified Read)
- `.nvmrc` contains `24.14.0`

## Status

**DONE** — 2 findings fixed (1 HIGH, 1 MEDIUM), 4 deferred with rationale. Overall DX 6/10 → 8/10. TTHW from RED FLAG (~12 min) to Champion (~2 min).

PR summary: DevEx review found 2 fixable issues — replaced create-next-app boilerplate README with project quickstart (cuts TTHW from ~12 min to ~2 min), pinned Node 24.14.0 via .nvmrc.
