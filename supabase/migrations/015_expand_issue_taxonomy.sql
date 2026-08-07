-- 015: expand the issue taxonomy beyond the original ten.
--
-- Why: the ten seeded in migration 006 forced real candidate material into
-- the wrong bucket during the 2026-08-07 coverage run, and independent
-- verifiers refuted stances over it — Everglades/water-quality planks landed
-- under `climate` for candidates who never mentioned climate change, and
-- school-safety/policing planks landed under `criminal_justice`. Each slug
-- below comes from material that recurred across the 2026 FL field.
--
-- Classification: additive. Existing rows are untouched; existing stance,
-- vote, and statement slugs keep resolving. Slugs are append-only by
-- convention — renaming or deleting one orphans stored `issue_slug` values
-- in candidates.top_stances (JSONB), candidate_voting_record.issue_slugs,
-- and candidate_statements.issue_slugs, none of which have FKs to this table.
--
-- Keep in sync with src/lib/issues.ts ISSUE_NAMES (same slugs, same names).
--
-- Adding a row here does NOT add the issue to the voter questionnaire; that
-- list is TOP_5_ISSUES in src/app/match/page.tsx.
--
-- Validation after apply:
--   SELECT slug, name FROM issues ORDER BY slug;  -- expect 17 rows
--
-- Rollback (safe only while no stance references the new slugs):
--   DELETE FROM issues WHERE slug IN ('environment','public_safety','veterans',
--     'government_reform','reproductive_rights','technology','civil_rights');
--
-- Idempotent: ON CONFLICT (slug) DO UPDATE, same shape as migration 006.

INSERT INTO issues (name, slug, category, description, active) VALUES
  ('Environment & Water', 'environment', 'Environment', 'Water quality, Everglades and wetlands restoration, red tide, conservation, pollution', true),
  ('Public Safety', 'public_safety', 'Social', 'Policing and law enforcement support, school safety, emergency response, disaster preparedness', true),
  ('Veterans', 'veterans', 'Social', 'VA healthcare and benefits, veteran employment, military family support', true),
  ('Government Reform', 'government_reform', 'Governance', 'Term limits, congressional stock trading, campaign finance, ethics, transparency, anti-corruption', true),
  ('Reproductive Rights', 'reproductive_rights', 'Rights', 'Abortion access and restrictions, contraception, IVF, maternal healthcare', true),
  ('Technology & AI', 'technology', 'Economic', 'Artificial intelligence, data centers, digital privacy, Big Tech regulation, broadband', true),
  ('Civil Rights', 'civil_rights', 'Rights', 'Voting rights, discrimination, free speech and religious liberty, equal protection', true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  active = EXCLUDED.active;
