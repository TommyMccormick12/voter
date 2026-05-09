-- Migration 006: Seed the 10 core issues
-- Slugs match src/lib/issues.ts ISSUE_NAMES keys exactly

INSERT INTO issues (name, slug, category, description, active) VALUES
  ('Economy & Jobs', 'economy', 'Economic', 'Jobs, wages, inflation, business climate, trade', true),
  ('Healthcare', 'healthcare', 'Social', 'Insurance access, drug prices, Medicare, Medicaid, ACA', true),
  ('Immigration', 'immigration', 'Social', 'Border policy, asylum, legal immigration, deportation', true),
  ('Climate & Energy', 'climate', 'Environment', 'Climate change, renewable energy, oil and gas, EPA regulation', true),
  ('Education', 'education', 'Social', 'K-12 funding, student debt, school choice, college affordability', true),
  ('Gun Policy', 'guns', 'Rights', 'Gun ownership rights, background checks, assault weapons, red flag laws', true),
  ('Criminal Justice', 'criminal_justice', 'Social', 'Policing, prison reform, sentencing, drug enforcement', true),
  ('Foreign Policy', 'foreign_policy', 'Defense', 'Military spending, alliances, Ukraine, Israel, China relations', true),
  ('Taxes', 'taxes', 'Economic', 'Income tax rates, corporate tax, deductions, capital gains', true),
  ('Housing', 'housing', 'Economic', 'Affordable housing, rent control, zoning, homeownership', true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  active = EXCLUDED.active;
