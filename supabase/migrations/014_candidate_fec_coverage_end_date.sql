-- Migration 014 — candidates.fec_coverage_end_date (Spec B3 loose end).
--
-- HANDOFF-2026-08-07 §5: the field is plumbed end-to-end in the app
-- (src/types/database.ts Candidate.fec_coverage_end_date, boundary.ts
-- defensive read, DonorProfile renders it next to every dollar figure)
-- but no DB column exists, so every read returns NULL. This migration
-- adds the column; the paired code change makes fetch_fec.ts write the
-- top-level field into fixtures and seed_candidates.ts persist it.
--
-- Classification: additive. No existing reads break — the app already
-- reads the field defensively and treats NULL as "do not render".
--
-- APPLY ORDER (important): apply this migration BEFORE merging the paired
-- code change. The code change adds fec_coverage_end_date to
-- CANDIDATE_BASE_COLUMNS (src/lib/data/candidates.ts); selecting a column
-- that does not exist fails the whole query, so code-first order would
-- break every candidate read on the live site. Column-first order is
-- safe: old code simply does not select the new column.
--
-- Backfill: none. Existing total_raised values came from earlier FEC
-- pulls whose coverage_end_date was not recorded; fabricating one would
-- violate the "never inferred or guessed" rule on this field
-- (src/types/database.ts). Rows stay NULL until the next money re-pull
-- (planned after Aug 8, Decision 7) stamps real values.
--
-- Validation after apply:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'candidates' AND column_name = 'fec_coverage_end_date';
--   -- expect one row, data_type = date
--
-- Rollback: drop the column. Safe while the paired code change is not
-- merged; after that merge, roll the code back first (reverse of apply
-- order). Rollback SQL (run by hand):
--   ALTER TABLE candidates DROP COLUMN IF EXISTS fec_coverage_end_date;
--
-- Idempotent: existence-guarded DO block; re-running is a no-op.
--
-- NOT applied by this task. File only — per data-and-release, migrations
-- are written and reviewed as files, never run against production by an
-- implementation agent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'candidates'
      AND column_name = 'fec_coverage_end_date'
  ) THEN
    ALTER TABLE candidates ADD COLUMN fec_coverage_end_date date;

    COMMENT ON COLUMN candidates.fec_coverage_end_date IS
      'Last date the FEC filings behind total_raised cover (FEC totals coverage_end_date, Spec B3). NULL means unknown — the UI must not render a coverage date. Written only by scripts/seed/seed_candidates.ts from fixture values that fetch_fec.ts stamped from the FEC API; never inferred.';
  END IF;
END $$;
