-- 018: add `infrastructure` to the issue taxonomy.
--
-- Why: the 17 slugs after migration 015 have no home for roads, bridges,
-- transit, ports, water and sewer systems, or broadband build-out. On
-- 2026-08-08 the synthesizer returned `infrastructure` for Charles Gambaro
-- (FL-06 R), whose platform leads with district infrastructure. It is not in
-- ISSUE_NAMES, so `issueName()` fell through to its `?? slug` branch and the
-- card would have rendered a bare lowercase "infrastructure" chip where
-- every other card shows a curated label.
--
-- Forced to pick from the existing 17, the model then chose `housing` for
-- roads, transit and utilities. A voter filtering on Housing would have been
-- handed an infrastructure statement, so that stance was dropped instead.
-- Dropping a real, sourced position because the taxonomy has no shelf for it
-- is the actual cost this migration removes.
--
-- This is the same failure 015 documents: the original ten forced real
-- material into the wrong bucket and verifiers refuted stances over it. The
-- taxonomy is a product surface, and a gap in it silently degrades coverage.
--
-- Classification: additive. Existing rows are untouched; every existing
-- stance, vote and statement slug keeps resolving. Slugs are append-only by
-- convention — renaming or deleting one orphans stored `issue_slug` values
-- in candidates.top_stances (JSONB), candidate_voting_record.issue_slugs,
-- and candidate_statements.issue_slugs, none of which have FKs to this table.
--
-- Keep in sync with src/lib/issues.ts ISSUE_NAMES (same slug, same name).
-- tests/issue-taxonomy.test.ts pins that pairing.
--
-- Adding a row here does NOT add the issue to the voter questionnaire; that
-- list is TOP_5_ISSUES in src/app/match/page.tsx and is deliberately unchanged.
--
-- Validation after apply:
--   SELECT slug, name FROM issues ORDER BY slug;  -- expect 18 rows
--
-- Rollback (safe only while no stance references the new slug):
--   DELETE FROM issues WHERE slug = 'infrastructure';
--
-- Idempotent: ON CONFLICT (slug) DO UPDATE, same shape as migrations 006 and 015.

INSERT INTO issues (name, slug, category, description, active) VALUES
  ('Infrastructure', 'infrastructure', 'Economic', 'Roads, bridges, transit, ports and airports, water and sewer systems, broadband build-out, resilience against flooding and storms', true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  active = EXCLUDED.active;
