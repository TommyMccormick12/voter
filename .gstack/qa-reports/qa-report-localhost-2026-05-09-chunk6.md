# QA Report — Chunk 6 (Multi-source data pipeline scripts)

**Date:** 2026-05-09
**Branch:** main
**Commit under test:** `87f3ca5` — feat(pivot): chunk 6 — multi-source data pipeline scripts
**Scope:** 27 files / +2983 lines: `scripts/ingest/*`, `scripts/synthesize/*`, `scripts/review/*`, `scripts/seed/*`, `src/lib/api-clients/*`, `src/lib/llm/curate.ts`, config (`.env.example`, `tsconfig.json`, `scripts/tsconfig.json`, `package.json`, `.gitignore`).

## Scope rationale
Chunk 6 adds the offline data pipeline. No app/runtime code paths changed (only `tsconfig.json` `exclude` and `package.json` scripts). Real ingestion needs five API keys the user hasn't added yet, so QA limits to:
1. Standard gates (build / lint / tests).
2. Smoke-test every new script: loads, prints usage, fails clearly without args/keys.
3. Spot-check error paths for clarity.

## Gates

| Gate | Result |
|------|--------|
| `npm run lint` | ✅ clean |
| `npx vitest run` | ✅ 27/27 pass (3 files) |
| `npm run build` | ✅ clean — 22 routes, no type errors |

The `scripts/**` directory is excluded from Next's typecheck via root `tsconfig.json`; scripts type-check independently via `scripts/tsconfig.json` (extends parent, `noEmit`). Confirmed neither leaks errors into the Next build.

## Script smoke tests

All 13 new scripts invoked with no args. Each prints a single-line usage and exits cleanly:

| Script | Usage line |
|--------|-----------|
| `ingest:ballotpedia` | `Usage: --race-slug "..." --race-id "race-nj-07-..."` |
| `ingest:opensecrets` | `Usage: --race-id "..." --state NJ [--cycle 2026]` |
| `ingest:fec` | `Usage: --race-id "..." --state NJ [--district 07] [--cycle 2026] [--office H\|S\|P]` |
| `ingest:propublica` | `Usage: --race-id "..." --state NJ [--chamber house\|senate] [--congress 119]` |
| `ingest:statements` | `Usage: --race-id "..."` |
| `ingest:zips` | `Usage: --zips 07059,07924 OR --zips-file path/to/zips.txt` |
| `synth:stances` | `Usage: --race-id "..." [--only-slug ballotpedia_slug]` |
| `synth:flag` | `Usage: --race-id "..."` |
| `review:doc` | `Usage: --race-id "..."` |
| `review:activate` | `Usage: --race-id "..." --slug "candidate-slug"` |
| `seed:race` | `Usage: --race-id "..."` |
| `seed:candidates` | `Usage: --race-id "..." [--include-unreviewed]` |

No import errors, no Zod schema errors at parse time — the modules wired together cleanly.

## Error-path spot-checks

- `synth:stances --race-id race-test-fake` (no fixture, no `ANTHROPIC_API_KEY`) →
  `Partial fixture missing: ...\race-test-fake.partial.json`
  ✅ Pre-condition fails before requiring env, which is the right order (saves an API call).

- `ingest:opensecrets --race-id race-test-fake --state NJ` (no fixture, no key) →
  `Partial fixture missing: ...\race-test-fake.partial.json. Run fetch_ballotpedia first.`
  ✅ Mentions the prerequisite step explicitly.

- `review:activate --race-id race-test-nonexistent --slug fake-person` →
  `Partial fixture missing: ...\race-test-nonexistent.partial.json`
  ✅ Clear.

## Citation validation (curate.ts)

`SynthesisSchema` (Zod) parses Haiku output. After parse, every `track_record_citations[]` entry is checked against the input `bill_id`s and `statement_id`s; unknown citations throw before fixture write. This is the guardrail against fabricated voting/statement references — verified by code reading (no live API call).

## Skipped (intentional)

- **End-to-end pipeline run for NJ-07**: requires Ballotpedia HTML access + 5 API keys. User has stated they will add keys later. Pipeline-real-data validation moves to a future ad-hoc /qa pass once keys are in `.env.local`.
- **Browser regression**: Chunk 6 changed zero app routes/components/styles. Build success confirms no app-code regression.

## Issues found

None.

## Next

→ Chunk 7: cleanup. Adapt `/share` + `/api/og` for match results (currently shows Phase 1 ranking image), update `Nav.tsx` copy ("All Races" → "Find your primary"), update root `CLAUDE.md` to reflect post-pivot architecture.
