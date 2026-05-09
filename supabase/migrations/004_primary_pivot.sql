-- Migration 004: Primary pivot
-- Adds election type, candidate stance caching, swipes, LLM matches, quick poll,
-- donor data, voting records, public statements

-- ============================================================
-- Races: distinguish primaries from generals
-- ============================================================
ALTER TABLE races ADD COLUMN IF NOT EXISTS election_type varchar(20) NOT NULL DEFAULT 'primary';
ALTER TABLE races ADD COLUMN IF NOT EXISTS primary_party varchar(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'election_type_valid'
  ) THEN
    ALTER TABLE races ADD CONSTRAINT election_type_valid
      CHECK (election_type IN ('primary','general','runoff'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_races_election ON races(election_type, election_date);

-- ============================================================
-- Candidates: party tag + denormalized top stances cache
-- ============================================================
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS primary_party varchar(20);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS top_stances jsonb DEFAULT '[]'::jsonb;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS incumbent boolean DEFAULT false;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS total_raised numeric(14,2);

-- ============================================================
-- Candidate positions: add sourcing metadata
-- ============================================================
ALTER TABLE candidate_positions ADD COLUMN IF NOT EXISTS confidence smallint DEFAULT 70;
ALTER TABLE candidate_positions ADD COLUMN IF NOT EXISTS source_type varchar(30);
ALTER TABLE candidate_positions ADD COLUMN IF NOT EXISTS source_excerpt text;
ALTER TABLE candidate_positions ADD COLUMN IF NOT EXISTS sourced_at timestamptz;

-- ============================================================
-- Swipes: candidate_swipes (left/right/save/detail)
-- ============================================================
CREATE TABLE IF NOT EXISTS candidate_swipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES sessions(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
  race_id uuid REFERENCES races(id) ON DELETE CASCADE,
  direction varchar(10) NOT NULL CHECK (direction IN ('right','left','save','detail')),
  swipe_order smallint,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_swipes_session ON candidate_swipes(session_id, race_id);
CREATE INDEX IF NOT EXISTS idx_swipes_candidate ON candidate_swipes(candidate_id, direction, created_at);

-- ============================================================
-- LLM matches: cache + telemetry for free-text matcher
-- ============================================================
CREATE TABLE IF NOT EXISTS llm_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  free_text text NOT NULL,
  free_text_hash text NOT NULL,
  race_id uuid REFERENCES races(id) ON DELETE CASCADE,
  model varchar(40) NOT NULL,
  input_tokens int,
  output_tokens int,
  ranked_candidates jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_cache ON llm_matches(free_text_hash, race_id);

-- ============================================================
-- Quick poll: weighted issue importance per session per race
-- ============================================================
CREATE TABLE IF NOT EXISTS quick_poll_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES sessions(id) ON DELETE CASCADE,
  race_id uuid REFERENCES races(id) ON DELETE CASCADE,
  issue_id uuid REFERENCES issues(id) ON DELETE CASCADE,
  weight smallint NOT NULL CHECK (weight BETWEEN 1 AND 5),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_poll_session ON quick_poll_responses(session_id, race_id);

-- ============================================================
-- Donor / fundraising data
-- ============================================================
CREATE TABLE IF NOT EXISTS candidate_donors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
  donor_name text NOT NULL,
  donor_type varchar(30),
  industry varchar(100),
  amount_total numeric(14,2),
  cycle smallint NOT NULL,
  fec_committee_id varchar(50),
  data_source varchar(30),
  rank_in_candidate smallint,
  fetched_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_donors_candidate ON candidate_donors(candidate_id, cycle, amount_total DESC);

CREATE TABLE IF NOT EXISTS candidate_top_industries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
  industry_name varchar(100) NOT NULL,
  industry_code varchar(20),
  amount numeric(14,2),
  rank smallint,
  cycle smallint NOT NULL,
  data_source varchar(30) DEFAULT 'opensecrets'
);
CREATE INDEX IF NOT EXISTS idx_top_industries_candidate ON candidate_top_industries(candidate_id, cycle, rank);

-- ============================================================
-- Voting record (incumbents only)
-- ============================================================
CREATE TABLE IF NOT EXISTS candidate_voting_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
  bill_id varchar(50) NOT NULL,
  bill_title text NOT NULL,
  bill_summary text,
  vote varchar(20) NOT NULL CHECK (vote IN ('yea','nay','present','absent','no_vote')),
  issue_slugs varchar(100)[],
  vote_date date NOT NULL,
  source varchar(30),
  source_url text,
  significance varchar(20)
);
CREATE INDEX IF NOT EXISTS idx_votes_candidate ON candidate_voting_record(candidate_id, vote_date DESC);
CREATE INDEX IF NOT EXISTS idx_votes_issue ON candidate_voting_record USING GIN(issue_slugs);

-- ============================================================
-- Public statements (speeches, op-eds, debates, social posts)
-- ============================================================
CREATE TABLE IF NOT EXISTS candidate_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
  statement_text text NOT NULL,
  statement_date date,
  context varchar(100),
  issue_slugs varchar(100)[],
  source_url text,
  source_quality smallint DEFAULT 70
);
CREATE INDEX IF NOT EXISTS idx_statements_candidate ON candidate_statements(candidate_id, statement_date DESC);
CREATE INDEX IF NOT EXISTS idx_statements_issue ON candidate_statements USING GIN(issue_slugs);

-- ============================================================
-- Data completeness view (for admin curation review)
-- ============================================================
CREATE OR REPLACE VIEW candidate_data_completeness AS
SELECT
  c.id,
  c.name,
  c.slug,
  c.state,
  c.district,
  c.primary_party,
  c.incumbent,
  COUNT(DISTINCT cp.id) AS positions_count,
  COUNT(DISTINCT cd.id) AS donors_count,
  COUNT(DISTINCT cti.id) AS industries_count,
  COUNT(DISTINCT cvr.id) AS votes_count,
  COUNT(DISTINCT cs.id) AS statements_count,
  jsonb_array_length(COALESCE(c.top_stances, '[]'::jsonb)) AS top_stances_count,
  c.active
FROM candidates c
LEFT JOIN candidate_positions cp ON cp.candidate_id = c.id
LEFT JOIN candidate_donors cd ON cd.candidate_id = c.id
LEFT JOIN candidate_top_industries cti ON cti.candidate_id = c.id
LEFT JOIN candidate_voting_record cvr ON cvr.candidate_id = c.id
LEFT JOIN candidate_statements cs ON cs.candidate_id = c.id
GROUP BY c.id, c.name, c.slug, c.state, c.district, c.primary_party, c.incumbent, c.top_stances, c.active;
