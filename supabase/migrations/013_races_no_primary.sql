-- 013: no-primary informational state on races (Spec A5, Decision 9).
--
-- FL-10 D (Maxwell Frost) has no primary contest: he qualified unopposed.
-- The race must still exist and stay viewable — never hidden, never faked
-- as a contest. These columns let the UI render the informational state.
--
-- Apply together with 011 before running scripts/seed/reconcile_roster_2026.ts.
-- After applying, add `no_primary, no_primary_note` to the SELECT column
-- lists in src/lib/data/races.ts (getRace, getRacesByIds) — they are read
-- defensively today and default to false/null until then.
--
-- Rollback:
--   ALTER TABLE races DROP COLUMN IF EXISTS no_primary;
--   ALTER TABLE races DROP COLUMN IF EXISTS no_primary_note;

ALTER TABLE races ADD COLUMN IF NOT EXISTS no_primary boolean NOT NULL DEFAULT false;
ALTER TABLE races ADD COLUMN IF NOT EXISTS no_primary_note text;

COMMENT ON COLUMN races.no_primary IS
  'True when the race has no primary contest (candidate qualified unopposed); UI shows the informational state instead of a contest.';
COMMENT ON COLUMN races.no_primary_note IS
  'Voter-facing one-liner, e.g. "No primary — Maxwell Alejandro Frost qualified unopposed and advances".';
