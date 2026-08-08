-- Migration 017: record how many candidates are actually on the ballot.
--
-- The application can only count candidates it has profiled, and it seeds a
-- candidate row only once that candidate clears the evidence gate. So the
-- database knows 97 candidates while the qualified roster holds 165. Every
-- surface that counted candidates was therefore reporting coverage and
-- labelling it as the ballot: the race picker showed "3 candidates" for a
-- FL-16 D race that lists 5.
--
-- Migration 016's sibling fix (#28) stopped the false claim by relabelling
-- those counts "with policy data". That is honest but vague. This column
-- carries the real denominator so a voter can be told "showing 3 of 10".
--
-- Source of truth is the Florida DOE qualified-candidate spine, which is
-- already captured per race in supabase/seed/candidates/*.partial.json.
-- scripts/seed/seed_races.ts writes the value from that fixture.
--
-- Nullable on purpose. A null means "we have not established the ballot
-- size for this race", which the UI must treat as unknown and fall back to
-- the softer disclosure. It must never render as zero.

ALTER TABLE races
  ADD COLUMN IF NOT EXISTS ballot_candidate_count integer;

ALTER TABLE races
  DROP CONSTRAINT IF EXISTS races_ballot_candidate_count_nonneg;

ALTER TABLE races
  ADD CONSTRAINT races_ballot_candidate_count_nonneg
  CHECK (ballot_candidate_count IS NULL OR ballot_candidate_count >= 0);

COMMENT ON COLUMN races.ballot_candidate_count IS
  'Qualified candidates on this ballot per the FL DOE spine. The denominator for "showing N of M". NULL means unknown, never zero.';
