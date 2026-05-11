-- Migration 008 — enable RLS + public-read policy on `races`.
--
-- The races table predates the RLS conventions in migrations 001/005.
-- Anon SELECT works today only because RLS is off (Postgres default-allow).
-- That's a defense-in-depth gap: if we ever add write columns or per-row
-- visibility rules later, we don't want anon reads to be implicit.
--
-- Public read is correct here: races are public-record civic data. Writes
-- continue to flow through the service-role seed scripts (no public
-- insert/update/delete policy).
--
-- Idempotent: every change wrapped in DO blocks so a re-run is a no-op.

DO $$
BEGIN
  -- Enable RLS if not already on
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'races' AND rowsecurity = true
  ) THEN
    ALTER TABLE races ENABLE ROW LEVEL SECURITY;
  END IF;

  -- Create public-read policy if it doesn't already exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'races' AND policyname = 'Public read races'
  ) THEN
    CREATE POLICY "Public read races" ON races FOR SELECT USING (true);
  END IF;
END $$;
