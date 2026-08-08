-- Migration 016: Preserve vote questions and exact roll-call identity.
--
-- bill_title becomes the voter-facing bill title after enrichment.
-- vote_question keeps procedural wording such as "On Motion to Recommit".
-- roll_call_id identifies one vote when a bill has multiple roll calls.
--
-- Existing top_stances.track_record_citations stay unchanged. They are JSONB
-- bill_id citations from earlier synthesis runs. The application does not
-- rewrite those reviewed statements. New synthesis runs require roll_call_id.

ALTER TABLE candidate_voting_record
  ADD COLUMN IF NOT EXISTS vote_question text;

ALTER TABLE candidate_voting_record
  ADD COLUMN IF NOT EXISTS roll_call_id varchar(100);

-- Before enrichment, bill_title held the vote question. Preserve that
-- truthful label for all existing rows. A later vote re-ingest supplies the
-- exact roll_call_id and replaces bill_title only when enrichment succeeds.
UPDATE candidate_voting_record
SET vote_question = bill_title
WHERE vote_question IS NULL;

CREATE INDEX IF NOT EXISTS idx_votes_roll_call
  ON candidate_voting_record(candidate_id, roll_call_id)
  WHERE roll_call_id IS NOT NULL;

COMMENT ON COLUMN candidate_voting_record.vote_question IS
  'Exact House or Senate roll-call question. Procedural-vote checks use this field.';

COMMENT ON COLUMN candidate_voting_record.roll_call_id IS
  'Stable source roll-call identity used by new track-record citations.';
