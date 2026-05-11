-- Migration 009 — candidate_reports table.
--
-- Backs the "Report inaccurate" feedback path (Phase 2D-quat §19.4).
-- A voter who sees a wrong stance attribution, an outdated quote, or
-- a fabricated bill citation files a report from /candidate/[slug];
-- the row queues for manual admin review on /admin.
--
-- Public insert, no public select. Admin reads via service role.
-- Idempotent: every change wrapped in DO blocks so a re-run is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'candidate_reports'
  ) THEN
    CREATE TABLE candidate_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text REFERENCES candidates(id) ON DELETE CASCADE,
      session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
      -- Which stance / claim is the user contesting? Optional —
      -- general reports leave it null.
      stance_id text,
      -- Optional bill_id reference if user is contesting a track-record citation
      cited_bill_id text,
      category text NOT NULL CHECK (category IN (
        'factual_error',
        'wrong_attribution',
        'outdated',
        'other'
      )),
      description text NOT NULL,
      -- Optional reporter email (null = anonymous report). When provided
      -- we may follow up if the report is actionable.
      reporter_email text,
      -- HMAC-keyed IP hash for spam de-dup. Never the raw IP.
      ip_hash text,
      status text DEFAULT 'open' CHECK (status IN (
        'open',
        'reviewed',
        'resolved',
        'dismissed'
      )),
      created_at timestamptz DEFAULT now(),
      reviewed_at timestamptz
    );

    CREATE INDEX idx_reports_candidate ON candidate_reports(candidate_id, status, created_at DESC);
    CREATE INDEX idx_reports_status ON candidate_reports(status, created_at DESC);
  END IF;

  -- RLS: public insert (anyone with a session cookie can report).
  -- No SELECT policy = no public read. Admin reads via service-role
  -- client (RLS-bypass) from /admin.
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'candidate_reports' AND rowsecurity = true
  ) THEN
    ALTER TABLE candidate_reports ENABLE ROW LEVEL SECURITY;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'candidate_reports'
      AND policyname = 'Public insert reports'
  ) THEN
    CREATE POLICY "Public insert reports" ON candidate_reports
      FOR INSERT WITH CHECK (true);
  END IF;
END $$;
