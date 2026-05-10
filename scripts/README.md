# Data pipeline scripts

End-to-end pipeline for ingesting candidate data, synthesizing stances with Haiku, reviewing the output, and seeding Supabase.

**These scripts run locally**, not as part of the production runtime. They write to local fixture files (`supabase/seed/candidates/*.partial.json`), then upload to Supabase via the service role key. Cached API responses live in `supabase/seed/raw/` so re-runs are free.

## Required environment variables

Add to `.env.local` (gitignored). All keys are free.

```bash
# Anthropic — for stance synthesis (cheapest tier: Haiku 4.5)
ANTHROPIC_API_KEY=sk-ant-...

# FEC.gov — raw filings, source-of-truth fundraising totals + itemized donors.
# Industry classification is done downstream by Haiku (OpenSecrets and
# FollowTheMoney both retired their public APIs).
# https://api.data.gov/signup/
FEC_API_KEY=...

# Supabase service role (for seed writes; bypasses RLS)
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

**Keyless services used by the pipeline:**
- **GovTrack** — congressional voting records (replaced ProPublica, sunset 2023)
- **Census Geocoding API** — ZIP → Congressional District
- **Ballotpedia** — candidate bios + key messages (scraped)

## End-to-end pipeline

For one race (NJ-07 Republican Primary, June 2 2026):

```bash
# 0. Set the race ID once for convenience
export RACE_ID=race-nj-07-r-2026

# 1. Pull Ballotpedia: candidate list + bios + key messages
npx tsx scripts/ingest/fetch_ballotpedia.ts \
  --race-slug "U.S._House_New_Jersey_District_7_election,_2026_(Republican_primary)" \
  --race-id "$RACE_ID"

# 2. Pull FEC: fundraising totals + FEC IDs (source of truth)
npx tsx scripts/ingest/fetch_fec.ts \
  --race-id "$RACE_ID" --state NJ --district 07 --cycle 2026 --office H

# 3. Classify donor industries via Haiku (FEC's itemized contributions → buckets).
#    Replaces what OpenSecrets used to do. ~$0.007 per candidate.
npx tsx scripts/ingest/classify_industries.ts \
  --race-id "$RACE_ID" --cycle 2026

# 4. Pull GovTrack voting record (incumbents only — challengers skipped)
npx tsx scripts/ingest/fetch_votes.ts \
  --race-id "$RACE_ID" --state NJ --chamber house

# 5. Scrape recent statements from each candidate's campaign site
npx tsx scripts/ingest/fetch_statements.ts --race-id "$RACE_ID"

# 6. Synthesize top_stances with Haiku (combining all of the above)
npx tsx scripts/synthesize/synthesize_stances.ts --race-id "$RACE_ID"

# 7. Flag inconsistencies for human review
npx tsx scripts/synthesize/flag_inconsistencies.ts --race-id "$RACE_ID"

# 8. Generate per-candidate review docs (Markdown)
npx tsx scripts/review/generate_review_doc.ts --race-id "$RACE_ID"

# 9. Manually review supabase/seed/review/$RACE_ID/*.md
#    For each candidate that passes, activate them:
npx tsx scripts/review/activate_candidate.ts \
  --race-id "$RACE_ID" --slug thomas-kean-jr

# 10. Seed Supabase (idempotent — safe to re-run)
npx tsx scripts/seed/seed_races.ts --race-id "$RACE_ID"
npx tsx scripts/seed/seed_candidates.ts --race-id "$RACE_ID"
```

## Output structure

```
supabase/seed/
├── candidates/
│   └── race-nj-07-r-2026.partial.json    # Merged fixture (built up step by step)
├── raw/                                   # API response cache (gitignored)
│   ├── ballotpedia.org/
│   ├── api.followthemoney.org/
│   ├── www.govtrack.us/
│   ├── api.open.fec.gov/
│   └── geocoding.geo.census.gov/
├── review/
│   └── race-nj-07-r-2026/
│       ├── thomas-kean-jr.md
│       ├── priya-mehta.md
│       └── ...
└── zip-districts.json                     # ZIP → CD lookup
```

## Pre-flight criteria (per plan §2.5)

Before committing to a race, run steps 1-5 and check:

- ≥ 4 candidates returned from Ballotpedia
- ≥ 3 key messages per candidate
- For incumbents: ≥ 10 voting record entries
- For challengers: ≥ 1 statement OR campaign website with content

If any of these fail, switch to a backup race (NY-17, MD-06, VA-07).

## Cost guardrails

- **FEC**: 1000/hour. ~3-4 calls per candidate (search + committees + itemized contributions + totals).
- **GovTrack**: no documented hard rate limit (keyless). ~2 calls per vote captured. Be polite — `fetchCached` throttles automatically.
- **Anthropic Haiku**: ~$0.001 per stance synthesis + ~$0.007 per industry classification. ~50 candidates ≈ $0.40 total.

The `fetchCached` helper in `src/lib/api-clients/base.ts` writes every response to `supabase/seed/raw/`, so re-running the pipeline is free.

## Failure & retry

- All ingest scripts are idempotent and resumable. If one fails partway, just re-run.
- The Haiku synthesis is deterministic per input — re-running gives the same output (modulo Haiku versions).
- To force a fresh API call, pass `force: true` to `fetchCached` or just delete the cache file.

## Adding a new race

1. Find the Ballotpedia race page slug (URL after `ballotpedia.org/`)
2. Pick a stable race-id pattern: `race-{state-lower}-{district}-{party-letter}-{cycle}` e.g. `race-ny-17-d-2026`
3. Run the pipeline above, swapping in the new args
4. Generate review docs, manually validate, activate candidates
5. Seed
