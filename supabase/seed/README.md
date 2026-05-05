# Seed Data

## baseline.sql

Seeds the database with:
1. **Core issues** (10 policy topics for the ranking interface)
2. **National baseline rankings** (for "You vs. community" comparison cold-start)

## Running

Against local Supabase:
```bash
supabase db reset  # runs migrations then seed
```

Against remote:
```bash
psql $DATABASE_URL -f supabase/seed/baseline.sql
```

## Data Sources

National baseline rankings are approximated from publicly available polling patterns (Pew Research issue priority surveys, 2025). Numbers represent typical American issue prioritization patterns.

These are clearly labeled in the app UI as "based on national surveys" and only shown when a zip code has fewer than 10 local responses.

## Issue Slugs

Must stay in sync with `src/lib/issues.ts`:
economy, healthcare, immigration, climate, education, guns, criminal_justice, foreign_policy, taxes, housing
