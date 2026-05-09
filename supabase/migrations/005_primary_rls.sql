-- Migration 005: RLS policies for the primary pivot tables
-- Public insert on user-action tables (interactions, polls, visits)
-- llm_matches and consent_audit are server-only (write via service role)
-- Public select on public-record candidate data tables

ALTER TABLE candidate_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE quick_poll_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_donors ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_top_industries ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_voting_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_audit ENABLE ROW LEVEL SECURITY;

-- candidate_interactions: anyone can insert; analytics read public
CREATE POLICY "Public insert interactions" ON candidate_interactions FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read interactions" ON candidate_interactions FOR SELECT USING (true);

-- quick_poll_responses: anyone can insert; aggregate analytics read public
CREATE POLICY "Public insert poll responses" ON quick_poll_responses FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read poll responses" ON quick_poll_responses FOR SELECT USING (true);

-- session_visits: insert via API route only (server adds geo + UA hash)
CREATE POLICY "Public insert visits" ON session_visits FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read visits" ON session_visits FOR SELECT USING (true);

-- llm_matches: server-only (no public policies — cache lookup goes through API)
-- consent_audit: server-only (immutable audit trail; written via API route)

-- Public-record data tables: read-only public
CREATE POLICY "Public read donors" ON candidate_donors FOR SELECT USING (true);
CREATE POLICY "Public read top industries" ON candidate_top_industries FOR SELECT USING (true);
CREATE POLICY "Public read voting record" ON candidate_voting_record FOR SELECT USING (true);
CREATE POLICY "Public read statements" ON candidate_statements FOR SELECT USING (true);
