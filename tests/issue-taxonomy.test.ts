// The issue taxonomy lives in two places that must agree: ISSUE_NAMES in
// src/lib/issues.ts (what the app renders and what stances are filed under)
// and the `issues` table seeded by supabase/migrations/006 + 015 + 018 (what the
// QuickPoll validates submitted slugs against, via src/lib/app/quick-poll.ts).
//
// Drift between them is silent and user-visible: a slug present only in code
// renders fine on a scorecard but makes a QuickPoll submission 400; a slug
// present only in SQL is a dead row. This suite pins them together so adding
// a topic to one without the other fails here rather than in production.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ISSUE_NAMES, issueLabel, issueLabelShort } from '@/lib/issues';

const MIGRATION_DIR = join(process.cwd(), 'supabase', 'migrations');

/** Pull (name, slug) pairs out of an `INSERT INTO issues ... VALUES` block. */
function seededIssues(file: string): Array<{ name: string; slug: string }> {
  const raw = readFileSync(join(MIGRATION_DIR, file), 'utf8');
  // Strip `--` comments first: the rollback note in 015 contains a quoted
  // slug list that otherwise parses as a seeded row.
  const sql = raw
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  const rows: Array<{ name: string; slug: string }> = [];
  // ('Economy & Jobs', 'economy', 'Economic', '...', true)
  const re = /\(\s*'([^']+)'\s*,\s*'([a-z_]+)'\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    rows.push({ name: m[1], slug: m[2] });
  }
  return rows;
}

describe('issue taxonomy stays in sync between code and migrations', () => {
  const seeded = [
    ...seededIssues('006_seed_issues.sql'),
    ...seededIssues('015_expand_issue_taxonomy.sql'),
    // 018 adds `infrastructure`. The synthesizer reached for it unprompted
    // for a candidate whose platform leads with roads and utilities, and
    // with no such slug the stance had to be dropped rather than filed in a
    // bucket that would mislead — see the migration header.
    ...seededIssues('018_infrastructure_issue.sql'),
  ];

  it('seeds every slug the app knows about, and no others', () => {
    expect(seeded.length).toBeGreaterThan(0);
    const seededSlugs = seeded.map((r) => r.slug).sort();
    const codeSlugs = Object.keys(ISSUE_NAMES).sort();
    expect(seededSlugs).toEqual(codeSlugs);
  });

  it('uses the same display name in SQL as in ISSUE_NAMES', () => {
    for (const row of seeded) {
      expect(row.name, `display name for "${row.slug}"`).toBe(ISSUE_NAMES[row.slug]);
    }
  });

  it('seeds no slug twice across migrations', () => {
    const slugs = seeded.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('issue label helpers', () => {
  it('returns the full name for a known slug', () => {
    expect(issueLabel('environment')).toBe('Environment & Water');
  });

  it('falls back to the raw slug rather than rendering blank', () => {
    expect(issueLabel('not_a_real_issue')).toBe('not_a_real_issue');
    expect(issueLabelShort('not_a_real_issue')).toBe('not_a_real_issue');
  });

  it('short labels fall through to the full name when no short form exists', () => {
    expect(issueLabelShort('healthcare')).toBe(ISSUE_NAMES.healthcare);
  });

  it('short labels stay short enough for the carousel card', () => {
    for (const slug of Object.keys(ISSUE_NAMES)) {
      expect(issueLabelShort(slug).length, `short label for "${slug}"`).toBeLessThanOrEqual(16);
    }
  });
});
