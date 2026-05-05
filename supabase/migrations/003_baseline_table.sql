-- Baseline rankings table for national-level aggregate data
-- Used for "You vs. community" comparison when local zip data is sparse

CREATE TABLE IF NOT EXISTS baseline_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_slug varchar(100) NOT NULL,
  avg_rank numeric(3,1) NOT NULL,
  response_pct numeric(4,1) NOT NULL,
  source varchar(200) NOT NULL,
  year smallint NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(issue_slug, year)
);

ALTER TABLE baseline_rankings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read baseline" ON baseline_rankings FOR SELECT USING (true);
