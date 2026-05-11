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

**Optional env (specific ingesters):**

```bash
# NewsAPI.org — public statements ingester (npm run ingest:news).
# Free 100 req/day, 1-month rolling archive. Skipped silently when unset.
# https://newsapi.org/register
NEWSAPI_KEY=
```

**Keyless services used by the pipeline:**
- **Wikipedia** — bio + "Political positions" extraction (primary platform source)
- **GovTrack** — congressional voting records (replaced ProPublica, sunset 2023)
- **HUD ZIP→CD crosswalk** — national ZIP coverage (quarterly XLSX, free signup)
- **Ballotpedia** — kept as fallback, but 2026 federal coverage is too thin to rely on

## End-to-end pipeline

For one race (FL-13 Republican Primary, Aug 18 2026):

```bash
# 0. Set the race ID once for convenience
export RACE_ID=race-fl-13-r-2026

# 1. Seed candidates from FEC (Ballotpedia 2026 coverage is too thin to use).
#    Use --primary-party to filter the FEC roster.
npm run ingest:fec -- \
  --race-id "$RACE_ID" --state FL --district 13 --cycle 2026 \
  --office H --primary-party R

# 2. Pull Wikipedia "Political positions" + Haiku extraction into the
#    10-issue taxonomy. Skips candidates with no Wikipedia page.
npm run ingest:platform -- --race-id "$RACE_ID"

# 2b. (optional) Playwright fallback for candidates with no Wikipedia.
#     Tries /issues, /platform, /priorities on each candidate.website URL.
npm run ingest:campaign-site -- --race-id "$RACE_ID"

# 2c. (optional) Hand-author for the long tail (neither Wikipedia nor a
#     usable campaign site). JSON shape:
#       { slug, bio?, key_messages?: string[],
#         campaign_themes?: [{heading, text}], website? }
npm run ingest:author -- --race-id "$RACE_ID" \
  --file authored/race-fl-13-r--name.json

# 3. Classify donor industries via Haiku (FEC's itemized contributions →
#    19 buckets). ~$0.007 per candidate. Replaces OpenSecrets.
npm run ingest:industries -- --race-id "$RACE_ID" --cycle 2026

# 4. Pull GovTrack voting record (incumbents only — challengers skipped).
npm run ingest:votes -- --race-id "$RACE_ID" --state FL --chamber house

# 5. (optional) NewsAPI-driven statement ingester. Requires NEWSAPI_KEY.
npm run ingest:news -- --race-id "$RACE_ID"

# 6. Synthesize top_stances with Haiku
npm run synth:stances -- --race-id "$RACE_ID"

# 7. Flag inconsistencies for human review
npm run synth:flag -- --race-id "$RACE_ID"

# 8. Generate per-candidate review docs (Markdown)
npm run review:doc -- --race-id "$RACE_ID"

# 8b. (optional) Self-contained HTML preview of one scorecard for
#     stakeholder review. Inline Tailwind CDN — opens offline.
npm run review:preview -- --slug laurel-lee --output ~/Downloads/lee.html

# 9. Manually review supabase/seed/review/$RACE_ID/*.md, then activate
npm run review:activate -- --race-id "$RACE_ID" --slug laurel-lee

# 10. Seed Supabase (idempotent — safe to re-run)
npm run seed:race -- --race-id "$RACE_ID"
npm run seed:candidates -- --race-id "$RACE_ID"
```

## National ZIP→district coverage (one-time per quarter)

```bash
# Sign up free at https://www.huduser.gov/portal/datasets/usps_crosswalk.html
# Download the latest ZIP_CD_<period>.xlsx. Then:
npm run ingest:hud-zips -- --file path/to/ZIP_CD_122025.xlsx
# Default --states FL. Pass --states FL,GA,NY to expand.
```

Writes to `supabase/seed/zip-districts.json` and is picked up by the runtime
data layer (`src/lib/data/races.ts`) on the next request. ~1,400 ZIPs per
state, all districts covered.

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
