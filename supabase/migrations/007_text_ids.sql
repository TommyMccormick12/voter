-- Migration 007 — convert races.id and candidates.id from uuid to text.
--
-- The app uses human-readable string IDs throughout (mock data,
-- /scorecards/[raceId] routes, race-id args on every ingest script).
-- The initial schema declared these as uuid + gen_random_uuid() which
-- doesn't match the app's identifier conventions. Safe to run on an
-- empty DB; not safe to run on a DB with existing data.
--
-- Idempotent guards: every change wrapped in DO blocks so a re-run is
-- a no-op once the conversion is done.

DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'races' AND column_name = 'id') = 'uuid' THEN

    -- Drop every FK that points at races.id or candidates.id so the type
    -- changes can run.
    ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_race_id_fkey;
    ALTER TABLE candidate_positions DROP CONSTRAINT IF EXISTS candidate_positions_candidate_id_fkey;
    ALTER TABLE candidate_donors DROP CONSTRAINT IF EXISTS candidate_donors_candidate_id_fkey;
    ALTER TABLE candidate_top_industries DROP CONSTRAINT IF EXISTS candidate_top_industries_candidate_id_fkey;
    ALTER TABLE candidate_voting_record DROP CONSTRAINT IF EXISTS candidate_voting_record_candidate_id_fkey;
    ALTER TABLE candidate_statements DROP CONSTRAINT IF EXISTS candidate_statements_candidate_id_fkey;
    ALTER TABLE candidate_interactions DROP CONSTRAINT IF EXISTS candidate_interactions_candidate_id_fkey;
    ALTER TABLE candidate_interactions DROP CONSTRAINT IF EXISTS candidate_interactions_race_id_fkey;
    ALTER TABLE llm_matches DROP CONSTRAINT IF EXISTS llm_matches_race_id_fkey;
    ALTER TABLE quick_poll_responses DROP CONSTRAINT IF EXISTS quick_poll_responses_race_id_fkey;
    -- Phase 1 leftover tables that also FK to races/candidates
    ALTER TABLE candidate_comparisons DROP CONSTRAINT IF EXISTS candidate_comparisons_candidate_a_id_fkey;
    ALTER TABLE candidate_comparisons DROP CONSTRAINT IF EXISTS candidate_comparisons_candidate_b_id_fkey;
    ALTER TABLE candidate_comparisons DROP CONSTRAINT IF EXISTS candidate_comparisons_preferred_candidate_id_fkey;
    ALTER TABLE candidate_comparisons DROP CONSTRAINT IF EXISTS candidate_comparisons_race_id_fkey;
    ALTER TABLE engagement_events DROP CONSTRAINT IF EXISTS engagement_events_candidate_id_fkey;

    -- Drop defaults that would block type changes
    ALTER TABLE races ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE candidates ALTER COLUMN id DROP DEFAULT;

    -- Drop the candidate_data_completeness view that depends on these columns
    DROP VIEW IF EXISTS candidate_data_completeness;

    -- Convert all uuid columns referencing races/candidates to text
    ALTER TABLE races ALTER COLUMN id TYPE text USING id::text;
    ALTER TABLE candidates ALTER COLUMN id TYPE text USING id::text;
    ALTER TABLE candidates ALTER COLUMN race_id TYPE text USING race_id::text;
    ALTER TABLE candidate_positions ALTER COLUMN candidate_id TYPE text USING candidate_id::text;
    ALTER TABLE candidate_donors ALTER COLUMN candidate_id TYPE text USING candidate_id::text;
    ALTER TABLE candidate_top_industries ALTER COLUMN candidate_id TYPE text USING candidate_id::text;
    ALTER TABLE candidate_voting_record ALTER COLUMN candidate_id TYPE text USING candidate_id::text;
    ALTER TABLE candidate_statements ALTER COLUMN candidate_id TYPE text USING candidate_id::text;
    ALTER TABLE candidate_interactions ALTER COLUMN candidate_id TYPE text USING candidate_id::text;
    ALTER TABLE candidate_interactions ALTER COLUMN race_id TYPE text USING race_id::text;
    ALTER TABLE llm_matches ALTER COLUMN race_id TYPE text USING race_id::text;
    ALTER TABLE quick_poll_responses ALTER COLUMN race_id TYPE text USING race_id::text;
    ALTER TABLE candidate_comparisons ALTER COLUMN candidate_a_id TYPE text USING candidate_a_id::text;
    ALTER TABLE candidate_comparisons ALTER COLUMN candidate_b_id TYPE text USING candidate_b_id::text;
    ALTER TABLE candidate_comparisons ALTER COLUMN preferred_candidate_id TYPE text USING preferred_candidate_id::text;
    ALTER TABLE candidate_comparisons ALTER COLUMN race_id TYPE text USING race_id::text;
    ALTER TABLE engagement_events ALTER COLUMN candidate_id TYPE text USING candidate_id::text;

    -- Re-add FKs with text typing
    ALTER TABLE candidates ADD CONSTRAINT candidates_race_id_fkey FOREIGN KEY (race_id) REFERENCES races(id);
    ALTER TABLE candidate_positions ADD CONSTRAINT candidate_positions_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE;
    ALTER TABLE candidate_donors ADD CONSTRAINT candidate_donors_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE;
    ALTER TABLE candidate_top_industries ADD CONSTRAINT candidate_top_industries_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE;
    ALTER TABLE candidate_voting_record ADD CONSTRAINT candidate_voting_record_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE;
    ALTER TABLE candidate_statements ADD CONSTRAINT candidate_statements_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE;
    ALTER TABLE candidate_interactions ADD CONSTRAINT candidate_interactions_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id);
    ALTER TABLE candidate_interactions ADD CONSTRAINT candidate_interactions_race_id_fkey FOREIGN KEY (race_id) REFERENCES races(id);
    ALTER TABLE llm_matches ADD CONSTRAINT llm_matches_race_id_fkey FOREIGN KEY (race_id) REFERENCES races(id);
    ALTER TABLE quick_poll_responses ADD CONSTRAINT quick_poll_responses_race_id_fkey FOREIGN KEY (race_id) REFERENCES races(id);
    ALTER TABLE candidate_comparisons ADD CONSTRAINT candidate_comparisons_candidate_a_id_fkey FOREIGN KEY (candidate_a_id) REFERENCES candidates(id);
    ALTER TABLE candidate_comparisons ADD CONSTRAINT candidate_comparisons_candidate_b_id_fkey FOREIGN KEY (candidate_b_id) REFERENCES candidates(id);
    ALTER TABLE candidate_comparisons ADD CONSTRAINT candidate_comparisons_preferred_candidate_id_fkey FOREIGN KEY (preferred_candidate_id) REFERENCES candidates(id);
    ALTER TABLE candidate_comparisons ADD CONSTRAINT candidate_comparisons_race_id_fkey FOREIGN KEY (race_id) REFERENCES races(id);
    ALTER TABLE engagement_events ADD CONSTRAINT engagement_events_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES candidates(id);

    -- Recreate the completeness view
    CREATE VIEW candidate_data_completeness AS
    SELECT
      c.id, c.name, c.slug,
      COUNT(DISTINCT cp.id) AS positions_count,
      COUNT(DISTINCT cd.id) AS donors_count,
      COUNT(DISTINCT cvr.id) AS votes_count,
      COUNT(DISTINCT cs.id) AS statements_count,
      c.active
    FROM candidates c
    LEFT JOIN candidate_positions cp ON cp.candidate_id = c.id
    LEFT JOIN candidate_donors cd ON cd.candidate_id = c.id
    LEFT JOIN candidate_voting_record cvr ON cvr.candidate_id = c.id
    LEFT JOIN candidate_statements cs ON cs.candidate_id = c.id
    GROUP BY c.id, c.name, c.slug, c.active;

  END IF;
END $$;
