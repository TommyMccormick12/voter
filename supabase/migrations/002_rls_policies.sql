-- RLS policies for user-facing tables
-- Session tokens are 64-char hex (256 bits entropy) — unguessable
-- Phase 1: simple public access policies

-- Sessions: public insert, select, update
create policy "Insert sessions" on sessions for insert with check (true);
create policy "Select sessions" on sessions for select using (true);
create policy "Update sessions" on sessions for update using (true);

-- Issue rankings: public insert, select
create policy "Insert rankings" on issue_rankings for insert with check (true);
create policy "Select rankings" on issue_rankings for select using (true);

-- Engagement events: public insert
create policy "Insert events" on engagement_events for insert with check (true);

-- Candidate comparisons: public insert, select
create policy "Insert comparisons" on candidate_comparisons for insert with check (true);
create policy "Select comparisons" on candidate_comparisons for select using (true);
