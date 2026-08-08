# Handoff: vote identity and scorecard polish

Date: 2026-08-08

## Current state

- Repository: `TommyMccormick12/voter`
- Base branch: `main`
- Base commit: `b844fbaa0444e4e7ed6a9204e4e2e33ad67e26b6`
- Current branch: `main`
- Working tree: modified and uncommitted
- Draft pull request: not created
- Production changes in this continuation: none

The local implementation is complete. The local gates pass. No commit, push,
pull request, database write, or deployment occurred in this continuation.
The code is not safe to deploy until migration 016 runs in production.

## Completed implementation

The work from `HANDOFF-2026-08-08.md` is complete.

1. Vote ingestion now enriches `bill_title` with a voter-facing bill title.
   It keeps the original roll-call wording in `vote_question`.
2. Procedural-vote checks now read `vote_question`. This preserves the
   motion-to-recommit safety check.
3. New track-record citations use `roll_call_id`. They no longer use the
   ambiguous `bill_id` value.
4. Migration 016 adds `vote_question` and `roll_call_id`. It also adds the
   partial roll-call index.
5. Candidate seeding writes both new vote fields.
6. Scorecard pages show the existing information badge for `no_primary`
   races.
7. The Supabase type files now cover migrations through 016.
8. The Kendrick Meek review is closed. The current candidate is the former
   representative's son. His official name and slug remain `Kendrick Meek`
   and `kendrick-meek`.

## Validation from this continuation

All commands ran from `C:\Users\thoma\Ballot Match\voter`.

- `git diff --check`: passed
- `npm test`: 43 files and 492 tests passed
- `npm run typecheck`: passed for the application and scripts
- `npm run build`: passed with Next.js 16.2.4
- `npm run lint`: 0 errors and 17 existing warnings

The build also reported the existing Next.js warning about the deprecated
`middleware` file convention.

## Connection state

### GitHub

The GitHub CLI is connected as `TommyMccormick12`. The token has `repo`,
`workflow`, and `read:org` scopes. The account has access to this repository.

### Supabase

The direct Supabase connector works.

- Project name: `Voter`
- Project ID: `xfiutnvkkbhpvhsvdwrj`
- Organization ID: `vgvvfojjcitaczspmzyw`
- Region: `us-west-2`
- Status: `ACTIVE_HEALTHY`
- Postgres: 17.6.1.121

The local Supabase CLI is not installed. The repository has no
`supabase/config.toml` link. Use the direct connector or install and link the
CLI in a later session.

The live `candidate_voting_record` table does not contain `vote_question` or
`roll_call_id`. Migration 016 has not run. The connector migration list is
empty, so do not use that empty list as proof that migrations 001 through 015
did not run. The live schema proves that earlier migrations did run outside
the connector's migration history.

The Supabase advisors also reported existing items that are outside this pull
request. The most important security items are:

- `candidate_data_completeness` is a security-definer view.
- `spatial_ref_sys` has no RLS in the exposed `public` schema.
- `rls_auto_enable()` is executable by anonymous and authenticated roles.
- PostGIS functions and the PostGIS extension produce related public-schema
  warnings.

See the Supabase advisor URLs before a separate security change:

- https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view
- https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public
- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

Do not mix those findings into this pull request.

### Vercel

The direct Vercel connector works.

- Team: `tommymccormick12's projects`
- Team ID: `team_Imx9IihgGiULRAntRavDq531`
- Project: `voter`
- Project ID: `prj_Jk1H0316izqZXXtSosM70ci6lFvj`
- Framework: Next.js
- Production domains: `ballotmatch.org` and `www.ballotmatch.org`

The latest production deployment is ready. It uses base commit
`b844fbaa0444e4e7ed6a9204e4e2e33ad67e26b6`. The local Vercel CLI is not
installed, and the repository has no `.vercel/project.json` link.

## Required rollout order

Keep this order. The application types and seed code expect the new database
columns.

1. Create a feature branch from the current working tree.
2. Commit the listed files, push the branch, and open a draft pull request.
3. Apply migration 016 to the production Supabase project.
4. Run the verification SQL below.
5. Re-ingest voting records into the local fixtures.
6. Review the fixture diff. Check title fallbacks and procedural questions.
7. Reseed the affected candidate races.
8. Update the pull request with the reviewed fixture changes.
9. Verify the Vercel preview.
10. Merge the pull request.
11. Wait for the Git-triggered Vercel production deployment.
12. Verify the scorecard and candidate flows on `ballotmatch.org`.

Do not deploy the code before step 2. Do not seed before step 2.

## Migration 016

Apply `supabase/migrations/016_vote_identity_and_question.sql` to project
`xfiutnvkkbhpvhsvdwrj` with the Supabase `apply_migration` connector. Use the
migration name `vote_identity_and_question`.

The project record says that production DDL and seed writes need Tommy's
approval. Get that approval before this step.

Then run this read-only verification query:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'candidate_voting_record'
  and column_name in ('vote_question', 'roll_call_id')
order by column_name;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'candidate_voting_record'
  and indexname = 'idx_votes_roll_call';

select
  count(*) as total_rows,
  count(*) filter (where vote_question is null) as missing_vote_question,
  count(*) filter (where roll_call_id is null) as missing_roll_call_id
from candidate_voting_record;
```

The first query must return both columns. The second query must return the
new index. `missing_vote_question` must be zero for the existing rows after
the migration backfill. `missing_roll_call_id` can be nonzero until the
vote re-ingest and seed finish.

Run the Supabase security and performance advisors again after the migration.
Migration 016 should not add a new RLS or security finding.

## Vote re-ingest and reseed

The vote ingester needs `CONGRESS_GOV_API_KEY`. The seeder needs
`SUPABASE_SERVICE_ROLE_KEY`. Load them through the existing local environment
setup. Do not print either value.

Run this PowerShell block after migration 016. It updates every fixture that
contains an incumbent voting record.

```powershell
$fixtureFiles = Get-ChildItem -LiteralPath 'supabase\seed\candidates' -Filter '*.json' -File

foreach ($fixtureFile in $fixtureFiles) {
  $fixture = Get-Content -Raw -LiteralPath $fixtureFile.FullName | ConvertFrom-Json
  $voteCandidates = @($fixture.candidates | Where-Object {
    $_.has_voting_record -eq $true -or @($_.voting_record).Count -gt 0
  })

  if ($voteCandidates.Count -eq 0) {
    continue
  }

  $raceId = $fixture.race.id
  $state = $fixture.race.state
  $chamber = if ($fixture.race.office -eq 'U.S. Senate') { 'senate' } else { 'house' }

  npm run ingest:votes -- --race-id $raceId --state $state --chamber $chamber
  if ($LASTEXITCODE -ne 0) {
    throw "Vote ingestion failed for $raceId"
  }
}
```

Review the fixture changes before any database write:

```powershell
git diff --check
git diff -- supabase/seed/candidates
npm test
npm run typecheck
```

After review and explicit production-write approval, reseed the same races:

```powershell
$fixtureFiles = Get-ChildItem -LiteralPath 'supabase\seed\candidates' -Filter '*.json' -File

foreach ($fixtureFile in $fixtureFiles) {
  $fixture = Get-Content -Raw -LiteralPath $fixtureFile.FullName | ConvertFrom-Json
  $voteCandidates = @($fixture.candidates | Where-Object {
    $_.has_voting_record -eq $true -or @($_.voting_record).Count -gt 0
  })

  if ($voteCandidates.Count -eq 0) {
    continue
  }

  $raceId = $fixture.race.id
  npm run seed:candidates -- --race-id $raceId
  if ($LASTEXITCODE -ne 0) {
    throw "Candidate seed failed for $raceId"
  }
}
```

Do not pass `--include-unreviewed`.

After the seed, verify live coverage:

```sql
select
  count(*) as total_rows,
  count(*) filter (where vote_question is null) as missing_vote_question,
  count(*) filter (where roll_call_id is null) as missing_roll_call_id,
  count(distinct roll_call_id) as distinct_roll_calls
from candidate_voting_record;

select candidate_id, roll_call_id, count(*) as duplicate_count
from candidate_voting_record
where roll_call_id is not null
group by candidate_id, roll_call_id
having count(*) > 1;
```

The duplicate query must return no rows.

## Production verification

Check the Vercel deployment after the merge. Confirm that it is `READY`, that
its target is `production`, and that its Git SHA is the merge commit.

Then verify these flows with cache-busting query parameters:

1. Open one no-primary scorecard by direct URL. Confirm that the information
   badge appears and the match call to action stays soft-disabled.
2. Open one contested scorecard. Confirm that the new badge does not appear.
3. Open an incumbent candidate with a voting record. Confirm that bill titles
   are readable and procedural labels remain correct.
4. Run one synthesis test or review artifact that cites two different roll
   calls for the same bill. Confirm that each citation resolves by
   `roll_call_id`.

## Modified and new files

- `HANDOFF-2026-08-08.md`
- `HANDOFF-2026-08-08-NEXT.md`
- `scripts/ingest/fetch_votes.ts`
- `scripts/seed/seed_candidates.ts`
- `src/app/scorecards/[raceId]/page.tsx`
- `src/lib/data/boundary.ts`
- `src/lib/data/races.ts`
- `src/lib/llm/curate.ts`
- `src/types/database.ts`
- `src/types/supabase.ts`
- `supabase/migrations/016_vote_identity_and_question.sql`
- `tests/curate.test.ts`
- `tests/data-races.test.ts`
- `tests/fetch_votes.test.ts`
- `tests/procedural-votes.test.ts`
- `tests/voting-record-list.test.tsx`

## Stop conditions

Stop the rollout if any condition is true:

- Migration 016 fails or returns a partial result.
- The live schema still lacks either new column.
- The vote re-ingest removes or inverts a procedural vote.
- A candidate seed exits nonzero or deactivates a candidate.
- The Vercel preview fails the build or scorecard checks.
- The production deployment does not use the expected merge commit.
