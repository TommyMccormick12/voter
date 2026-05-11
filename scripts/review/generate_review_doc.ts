// Generate a per-candidate Markdown doc summarizing everything the
// pipeline pulled. Used for the manual-review pass before flipping
// candidates.active = true. Per the plan §2.4 — the synthesis output
// must be human-reviewed before going live.
//
// Usage:
//   npx tsx scripts/review/generate_review_doc.ts --race-id race-nj-07-r-2026

import '../_env';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANDIDATE_FIXTURE_DIR,
  REPO_ROOT,
} from '../../src/lib/api-clients/base';

interface Args {
  raceId: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let raceId = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--race-id') raceId = args[++i] ?? '';
  }
  if (!raceId) {
    console.error('Usage: --race-id "..."');
    process.exit(1);
  }
  return { raceId };
}

function fmtMoney(n: number | null | undefined): string {
  if (!n || n === 0) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function main() {
  const { raceId } = parseArgs();
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`Partial fixture missing: ${partialPath}`);
    process.exit(1);
  }
  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));
  const reviewDir = join(REPO_ROOT, 'supabase', 'seed', 'review', raceId);
  mkdirSync(reviewDir, { recursive: true });

  for (const c of fixture.candidates ?? []) {
    const lines: string[] = [];
    lines.push(`# ${c.name} — ${raceId}`);
    lines.push('');
    lines.push(`- Party: ${c.party ?? '?'}`);
    lines.push(`- Office: ${c.office ?? '?'}`);
    lines.push(`- Incumbent: ${c.incumbent ? 'yes' : 'no'}`);
    lines.push(`- Total raised (cycle): ${fmtMoney(c.total_raised)}`);
    lines.push(`- Ballotpedia: ${c.ballotpedia_url ?? '(none)'}`);
    lines.push(`- Campaign site: ${c.campaign_website ?? '(none)'}`);
    if (c.opensecrets_cid) lines.push(`- OpenSecrets CID: ${c.opensecrets_cid}`);
    if (c.fec_candidate_id) lines.push(`- FEC ID: ${c.fec_candidate_id}`);
    if (c.bioguide_id) lines.push(`- Bioguide ID: ${c.bioguide_id}`);
    if (c.govtrack_id) lines.push(`- GovTrack ID: ${c.govtrack_id}`);
    // Legacy field — preserved for fixtures created before the GovTrack swap.
    if (c.propublica_member_id) lines.push(`- ProPublica member ID (legacy): ${c.propublica_member_id}`);
    lines.push('');

    if (c.bio) {
      lines.push('## Bio');
      lines.push(c.bio);
      lines.push('');
    }

    lines.push('## Synthesized stances (Haiku output — REVIEW THESE)');
    if (!c.top_stances || c.top_stances.length === 0) {
      lines.push('_No stances synthesized._');
    } else {
      for (const s of c.top_stances) {
        lines.push(`### ${s.issue_slug} — ${s.stance} (confidence ${s.confidence}/100)`);
        lines.push(`> ${s.summary}`);
        if (s.source_excerpt) {
          lines.push('');
          lines.push(`Excerpt: "${s.source_excerpt}"`);
        }
        if (s.track_record_note) {
          lines.push('');
          lines.push(`**Track record:** ${s.track_record_note}`);
          if (s.track_record_citations?.length) {
            lines.push(`Citations: ${s.track_record_citations.join(', ')}`);
          }
        }
        lines.push('');
      }
    }

    lines.push('## Top donor industries');
    if (!c.top_industries || c.top_industries.length === 0) {
      lines.push('_None._');
    } else {
      for (const i of c.top_industries.slice(0, 10)) {
        lines.push(`- ${i.industry_name}: ${fmtMoney(i.amount)}`);
      }
    }
    lines.push('');

    lines.push('## Voting record (recent)');
    if (!c.voting_record || c.voting_record.length === 0) {
      lines.push('_None — challenger or not in office._');
    } else {
      for (const v of c.voting_record.slice(0, 20)) {
        lines.push(
          `- **${v.vote.toUpperCase()}** on ${v.bill_id} (${v.vote_date}): ${v.bill_title}`
        );
      }
    }
    lines.push('');

    lines.push('## Public statements');
    if (!c.statements || c.statements.length === 0) {
      lines.push('_None captured._');
    } else {
      for (const s of c.statements) {
        lines.push(`- ${s.statement_date ?? '(undated)'}: "${s.statement_text}"`);
      }
    }
    lines.push('');
    lines.push('---');
    lines.push('## Reviewer checklist');
    lines.push('- [ ] All synthesized stances accurately reflect the source data');
    lines.push('- [ ] Track-record notes are factually correct (verify each citation)');
    lines.push('- [ ] No fabricated stances on issues with no source signal');
    lines.push('- [ ] Confidence scores feel right (≥60 for stances we surface)');
    lines.push('- [ ] No defamatory or editorializing language');
    lines.push('- [ ] Source URLs resolve');
    lines.push('');
    lines.push(
      '**To activate:** `npx tsx scripts/review/activate_candidate.ts --race-id ' +
        raceId +
        ' --slug ' +
        (c.slug ?? '...') +
        '`'
    );

    const path = join(reviewDir, `${c.slug ?? slugify(c.name)}.md`);
    writeFileSync(path, lines.join('\n'));
    console.log(`[review] ${path}`);
  }

  console.log(
    `\n[review] generated ${fixture.candidates?.length ?? 0} review docs in ${reviewDir}`
  );
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

main();
