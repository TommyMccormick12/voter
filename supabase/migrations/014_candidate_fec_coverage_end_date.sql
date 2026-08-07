-- 014: candidates.fec_coverage_end_date (Spec B3, HANDOFF-2026-08-07 §5).
--
-- Last date the FEC filings behind total_raised cover. The UI
-- (DonorProfile via CandidateDetail), boundary.ts, and the Candidate type
-- were already plumbed end-to-end; this column plus the paired code change
-- (fetch_fec.ts stamps it, seed_candidates.ts persists it) light it up.
--
-- Additive; no backfill. Existing rows came from FEC pulls whose coverage
-- date was not recorded — fabricating one would violate the field's
-- "never inferred or guessed" rule (src/types/database.ts). Rows stay
-- NULL (UI hides the date) until the post-Aug-8 money re-pull
-- (Decision 7) stamps real values.
--
-- Apply BEFORE the next seed_candidates.ts run — the seed upsert now
-- always includes this column and fails loudly (PGRST204) without it.
-- After applying, add `fec_coverage_end_date` to CANDIDATE_BASE_COLUMNS
-- in src/lib/data/candidates.ts (two-phase note there) — it is read
-- defensively today and stays null until then.
--
-- Validation after apply:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'candidates' AND column_name = 'fec_coverage_end_date';
--   -- expect one row, data_type = date
--
-- Rollback (only while CANDIDATE_BASE_COLUMNS does not select the column;
-- after that follow-up merges, roll the code back first):
--   ALTER TABLE candidates DROP COLUMN IF EXISTS fec_coverage_end_date;

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS fec_coverage_end_date date;

COMMENT ON COLUMN candidates.fec_coverage_end_date IS
  'Last date the FEC filings behind total_raised cover (FEC totals coverage_end_date, Spec B3). NULL means unknown — the UI must not render a coverage date. Written only by scripts/seed/seed_candidates.ts from fixture values fetch_fec.ts stamped from the FEC API; never inferred.';
