-- Migration 012 — drop the three Phase 1 leftover tables.
--
-- T25 (SPEC-2026-08-06.md §F2, 2026-08-06 rework). The product pivoted
-- from Phase 1 issue-ranking to the carousel-scorecard + LLM-match model
-- (see AGENTS.md "Key design decisions" — "Pivoted from Phase 1
-- issue-ranking → carousel scorecards + LLM match. The old /priorities,
-- /compare, and /races routes have been deleted."). Three tables from
-- that phase are still live in the DB with no application code reading
-- or writing them:
--   - issue_rankings        (backed the deleted /priorities flow)
--   - candidate_comparisons (backed the deleted /compare flow)
--   - engagement_events     (superseded by candidate_interactions,
--                            quick_poll_responses, llm_matches — the
--                            tables the current app actually writes)
-- Confirmed dead: no reference to any of the three table names, or to
-- the corresponding src/types/database.ts types (IssueRanking,
-- CandidateComparison, EngagementEvent, EventType — removed from that
-- file in this same change), anywhere under src/ or scripts/.
--
-- ============================================================
-- APPROVED TO RUN — Tommy, 2026-08-07.
--
-- The two gates this file previously held are both satisfied:
--   1. Explicit approval to drop these three tables. Given 2026-08-07.
--   2. A verified restorable backup. Checked against production the same
--      day and found unnecessary: all three tables hold ZERO rows, and
--      `pg_constraint` reports no foreign key anywhere in the schema
--      referencing any of them. The drop therefore destroys no data and
--      cascades to nothing. What is lost is the empty structure, and
--      this file plus migrations 001–005 reconstruct that.
--
-- The change is still destructive and non-additive in form — there is no
-- corresponding "up" migration that undoes it. If these tables must come
-- back, recreate them from their original DDL in migrations 001 and 004
-- and re-apply their RLS policies from 005. No data needs to come with
-- them.
--
-- Verification queries used (re-run them before applying if any time has
-- passed, since a non-zero count would change this assessment):
--   select count(*) from issue_rankings;         -- was 0
--   select count(*) from candidate_comparisons;  -- was 0
--   select count(*) from engagement_events;      -- was 0
--   select c.conname, c.conrelid::regclass
--     from pg_constraint c
--    where c.contype = 'f'
--      and c.confrelid::regclass::text in ('issue_rankings',
--          'candidate_comparisons', 'engagement_events');  -- was empty
-- ============================================================
--
-- Migration steps (what this file does, once approved to run):
--   1. Drop the three tables' RLS policies explicitly (belt-and-suspenders
--      — `DROP TABLE` already removes policies with the table, but naming
--      them here makes the change reviewable statement-by-statement).
--   2. Drop the tables themselves (indexes drop automatically with their
--      table; no index needs a separate DROP INDEX statement).
--
-- Rollback steps (if this file has already run and the drop must be
-- undone): recreate the three tables from their DDL in migrations 001
-- and 004, then re-apply their RLS policies from 005. Recreating them
-- empty is a complete rollback here precisely because they were already
-- empty at drop time — the usual objection to a recreate-style rollback
-- (that it silently discards the rows that existed) does not apply.
-- If a future run finds a non-zero count, that objection returns and the
-- only safe rollback path becomes restoring a backup taken beforehand.
--
-- Validation steps (run after applying, before considering this done):
--   - `select count(*) from information_schema.tables where table_schema
--      = 'public' and table_name in ('issue_rankings',
--      'candidate_comparisons', 'engagement_events');` returns 0 rows.
--   - `npm run typecheck` still passes (src/types/supabase.ts documents
--      these three tables pending this drop — regenerate it, or hand-edit
--      to remove the three table entries, as a follow-up commit once this
--      migration has actually run against the target database).
--   - `/admin` still loads (it never queried these tables).
--
-- Client-generation steps: regenerate src/types/supabase.ts (or hand-edit
-- to remove the `issue_rankings` / `candidate_comparisons` /
-- `engagement_events` entries and their header comment) after this
-- migration has run — not before, so the generated types never describe
-- a schema state that does not exist yet in any environment.
--
-- Backfill / reconciliation: none. This is a pure drop of tables with no
-- surviving consumer; no data from them needs to move anywhere first.
--
-- Idempotent: `DROP ... IF EXISTS` guards make a re-run a no-op.

DROP POLICY IF EXISTS "Insert rankings" ON issue_rankings;
DROP POLICY IF EXISTS "Select rankings" ON issue_rankings;
DROP POLICY IF EXISTS "Insert comparisons" ON candidate_comparisons;
DROP POLICY IF EXISTS "Select comparisons" ON candidate_comparisons;
DROP POLICY IF EXISTS "Insert events" ON engagement_events;

DROP TABLE IF EXISTS issue_rankings;
DROP TABLE IF EXISTS candidate_comparisons;
DROP TABLE IF EXISTS engagement_events;
