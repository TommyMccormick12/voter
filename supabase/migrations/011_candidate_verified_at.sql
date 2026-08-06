-- Migration 011 — candidates.verified_at (freshness gate column).
--
-- T12 (SPEC-2026-08-06.md §B4, 2026-08-06 rework). DATA-AUDIT-2026-08-06
-- root cause 2 found FEC filings treated as proof of live candidacy, with
-- no re-verification ever required (Rubio, Rick Scott, Grayson, etc. all
-- stayed active long after they stopped being real candidates in their
-- seeded race). This column is the freshness contract the audit
-- recommends: every candidate row carries `verified_at`; a row missing it
-- or older than VERIFICATION_FRESHNESS_DAYS cannot stay/become active.
--
-- Enforcement lives in application code, not a DB constraint (a check
-- constraint can't express "now() - verified_at", and would need to be
-- IMMUTABLE-function-based or trigger-based to work at all — not worth
-- the complexity for a value the app already owns end to end):
--   - scripts/review/activate_candidate.ts stamps verified_at = now() at
--     review time, after the >=3-stances and DOE-spine candidacy gates
--     pass.
--   - scripts/seed/seed_candidates.ts (via scripts/seed/seed-validation.ts)
--     refuses to seed any active candidate whose verified_at is missing or
--     older than VERIFICATION_FRESHNESS_DAYS (14) — the named constant
--     lives once, in scripts/review/activation-gate.ts, and is imported
--     everywhere the rule is enforced.
--
-- Backfill strategy: existing ACTIVE rows get verified_at = now() at
-- apply time. Justification: this migration lands as part of the
-- 2026-08-06 data rebuild (SPEC-2026-08-06.md), which re-verifies every
-- candidate that stays active against the DOE spine (T02/T03/T26 —
-- adversarial verification gate) before this migration and the
-- corresponding reseed land in production. So "verified now" is true at
-- apply time, not a fabricated timestamp papering over unverified data.
-- Inactive rows are left NULL; they are not live, and only re-enter
-- circulation through activate_candidate.ts, which stamps a real
-- verified_at on reactivation.
--
-- Rollback: drop the column. Safe — this migration is additive-only and
-- nothing outside the two scripts above reads verified_at yet; once the
-- column is gone, both scripts' isVerifiedFresh() treats a missing
-- verified_at value the same as NULL (stale), which is a safe fail-closed
-- default, not a silent pass. Rollback SQL (run by hand; not executed by
-- this file, per data-and-release — migrations are written and reviewed
-- as files, not auto-applied):
--   ALTER TABLE candidates DROP COLUMN IF EXISTS verified_at;
--
-- Idempotent: wrapped in a DO block with an existence guard, so re-running
-- this file is a no-op once applied.
--
-- NOT applied by this task. File only — see data-and-release: migrations
-- are written and reviewed as files, never run against production by an
-- implementation agent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'candidates'
      AND column_name = 'verified_at'
  ) THEN
    ALTER TABLE candidates ADD COLUMN verified_at timestamptz;

    COMMENT ON COLUMN candidates.verified_at IS
      'Timestamp of the last activation-gate pass (>=3 top_stances + DOE spine candidacy check) for this candidate. NULL, or older than VERIFICATION_FRESHNESS_DAYS (14, scripts/review/activation-gate.ts), means the row cannot be (re)seeded as active — enforced in scripts/review/activate_candidate.ts and scripts/seed/seed_candidates.ts, not by a DB constraint.';

    -- Backfill: see header note above. Active rows only, at apply time.
    UPDATE candidates
    SET verified_at = now()
    WHERE active = true
      AND verified_at IS NULL;
  END IF;
END $$;
