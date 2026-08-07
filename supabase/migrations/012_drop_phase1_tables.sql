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
-- DO NOT RUN THIS FILE AGAINST PRODUCTION.
--
-- This migration is staged for review only, per data-and-release
-- ("separate schema rollout from destructive cleanup") and
-- SPEC-2026-08-06.md F2 ("DB table drops staged as a separate reviewed
-- migration, not run this session"). It must not be applied until:
--   1. Tommy has given explicit approval to drop these three tables, AND
--   2. A verified, restorable backup of the production database exists
--      (a Supabase point-in-time-recovery checkpoint or a `pg_dump`
--      taken immediately before this file runs).
-- This is a destructive, non-additive change (DROP TABLE with CASCADE
-- semantics on FKs) — it cannot be rolled back by re-running a
-- corresponding "up" migration. Rollback requires restoring the backup
-- taken in step 2.
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
-- undone): restore from the pre-migration backup described above. There
-- is no forward-only "recreate the table" rollback, because a recreated
-- empty table would silently discard whatever rows existed at drop time
-- — restoring the verified backup is the only rollback path that
-- preserves data.
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
