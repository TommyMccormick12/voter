-- Seed core issues for ranking
-- These 10 issues are the Phase 1 set. Slugs must match the app constants.
INSERT INTO issues (name, slug, category, description, active) VALUES
  ('Economy & Jobs', 'economy', 'Economic', 'Employment, wages, inflation, and economic growth', true),
  ('Healthcare', 'healthcare', 'Social', 'Healthcare access, costs, and insurance coverage', true),
  ('Immigration', 'immigration', 'Social', 'Immigration policy, border security, and pathways to citizenship', true),
  ('Climate & Energy', 'climate', 'Environment', 'Climate change, renewable energy, and environmental policy', true),
  ('Education', 'education', 'Social', 'K-12 education, higher education, and student debt', true),
  ('Gun Policy', 'guns', 'Rights', 'Gun control, Second Amendment rights, and firearm regulations', true),
  ('Criminal Justice', 'criminal_justice', 'Social', 'Policing, sentencing reform, and prison policy', true),
  ('Foreign Policy', 'foreign_policy', 'Defense', 'International relations, defense spending, and diplomacy', true),
  ('Taxes', 'taxes', 'Economic', 'Tax policy, rates, and government spending priorities', true),
  ('Housing', 'housing', 'Economic', 'Housing affordability, homelessness, and zoning policy', true)
ON CONFLICT (slug) DO NOTHING;

-- National baseline rankings (approximated from public polling patterns, 2025)
-- Source: patterns observed in Pew Research issue priority surveys
-- Used when a zip code has fewer than 10 local responses
INSERT INTO baseline_rankings (issue_slug, avg_rank, response_pct, source, year) VALUES
  ('economy', 1.8, 78.0, 'National baseline (approximated from Pew Research patterns)', 2025),
  ('healthcare', 2.9, 67.0, 'National baseline (approximated from Pew Research patterns)', 2025),
  ('immigration', 3.2, 61.0, 'National baseline (approximated from Pew Research patterns)', 2025),
  ('education', 4.1, 58.0, 'National baseline (approximated from Pew Research patterns)', 2025),
  ('criminal_justice', 4.8, 52.0, 'National baseline (approximated from Pew Research patterns)', 2025),
  ('climate', 5.5, 47.0, 'National baseline (approximated from Pew Research patterns)', 2025),
  ('taxes', 6.2, 44.0, 'National baseline (approximated from Pew Research patterns)', 2025),
  ('housing', 6.8, 41.0, 'National baseline (approximated from Pew Research patterns)', 2025),
  ('guns', 7.5, 38.0, 'National baseline (approximated from Pew Research patterns)', 2025),
  ('foreign_policy', 8.1, 33.0, 'National baseline (approximated from Pew Research patterns)', 2025)
ON CONFLICT (issue_slug, year) DO UPDATE SET
  avg_rank = EXCLUDED.avg_rank,
  response_pct = EXCLUDED.response_pct,
  source = EXCLUDED.source;
