-- Migration 010 — candidate_reports spam dedup.
--
-- /cso MED-3 follow-up. Rate limits prevent volume from a single session/IP,
-- but an organized actor with proxy rotation could still flood the admin
-- queue with duplicate-text reports. This adds:
--   1. A description_hash column — SHA-256 of lower(btrim(description)).
--   2. A backfill that populates it for existing rows.
--   3. A partial UNIQUE index over (ip_hash, candidate_id, description_hash)
--      that rejects exact-duplicate-text submissions from the same IP hash
--      on the same candidate. The API catches the unique-violation (23505)
--      and returns 200 silently — the spammer doesn't learn that dedup
--      fired.
--
-- Idempotent: re-running is a no-op.

DO $$
BEGIN
  -- 1. Add description_hash column.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'candidate_reports'
      AND column_name = 'description_hash'
  ) THEN
    ALTER TABLE candidate_reports
      ADD COLUMN description_hash text;
  END IF;

  -- 2. Backfill existing rows. lower(btrim(...)) must match the JS
  --    normalization in src/app/api/report/route.ts exactly.
  --    sha256() returns bytea; encode(..., 'hex') gives the same hex
  --    string the JS side produces.
  UPDATE candidate_reports
  SET description_hash = encode(sha256(lower(btrim(description))::bytea), 'hex')
  WHERE description_hash IS NULL
    AND description IS NOT NULL;

  -- 3. Partial unique index. Only enforces dedup when both ip_hash and
  --    description_hash are present, so legacy rows with NULL ip_hash
  --    (pre-/cso fix) don't block index creation. Postgres treats NULLs
  --    as distinct in unique indexes anyway, but the WHERE clause makes
  --    the intent explicit and keeps the index smaller.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'candidate_reports'
      AND indexname = 'ux_reports_dedup'
  ) THEN
    CREATE UNIQUE INDEX ux_reports_dedup
      ON candidate_reports (ip_hash, candidate_id, description_hash)
      WHERE ip_hash IS NOT NULL AND description_hash IS NOT NULL;
  END IF;

  -- 4. Supporting index for the /admin "top suspicious IPs" query.
  --    Lets us pull "reports per ip_hash in the last 7 days" without a
  --    seq scan as the table grows.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'candidate_reports'
      AND indexname = 'idx_reports_ip_recent'
  ) THEN
    CREATE INDEX idx_reports_ip_recent
      ON candidate_reports (ip_hash, created_at DESC)
      WHERE ip_hash IS NOT NULL;
  END IF;
END $$;
