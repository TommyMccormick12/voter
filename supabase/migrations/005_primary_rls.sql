-- Migration 005: RLS policies for the primary pivot tables
-- Public insert on user-action tables (swipes, polls, llm_matches via API only)
-- Public select on public-record candidate data tables

-- Enable RLS on all new tables
ALTER TABLE candidate_swipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE quick_poll_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_donors ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_top_industries ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_voting_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_statements ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- candidate_swipes: anyone can insert their swipe; analytics read public
-- ============================================================
CREATE POLICY "Public insert swipes" ON candidate_swipes FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read swipes" ON candidate_swipes FOR SELECT USING (true);

-- ============================================================
-- quick_poll_responses: anyone can insert; aggregate analytics read public
-- ============================================================
CREATE POLICY "Public insert poll responses" ON quick_poll_responses FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read poll responses" ON quick_poll_responses FOR SELECT USING (true);

-- ============================================================
-- llm_matches: write only via server route, no direct client access
-- (anon key blocked; service role bypasses RLS for the API route)
-- ============================================================
-- No public insert policy — server-only via service role
-- No public select policy — cache lookups happen server-side

-- ============================================================
-- Public-record data tables: read-only public, write via server only
-- ============================================================
CREATE POLICY "Public read donors" ON candidate_donors FOR SELECT USING (true);
CREATE POLICY "Public read top industries" ON candidate_top_industries FOR SELECT USING (true);
CREATE POLICY "Public read voting record" ON candidate_voting_record FOR SELECT USING (true);
CREATE POLICY "Public read statements" ON candidate_statements FOR SELECT USING (true);
