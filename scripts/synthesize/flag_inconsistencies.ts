// Scan a race fixture for stance/record contradictions that the synthesis
// step might have missed. Writes a report to stdout. Used as a manual-review
// gate before activating candidates for production.
//
// Usage:
//   npx tsx scripts/synthesize/flag_inconsistencies.ts --race-id race-nj-07-r-2026

import '../_env';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CANDIDATE_FIXTURE_DIR } from '../../src/lib/api-clients/base';

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

interface FlagResult {
  candidate: string;
  issue_slug: string;
  flag: string;
  severity: 'info' | 'warning' | 'high';
}

function main() {
  const { raceId } = parseArgs();
  const partialPath = join(CANDIDATE_FIXTURE_DIR, `${raceId}.partial.json`);
  if (!existsSync(partialPath)) {
    console.error(`Partial fixture missing: ${partialPath}`);
    process.exit(1);
  }
  const fixture = JSON.parse(readFileSync(partialPath, 'utf8'));

  const flags: FlagResult[] = [];

  for (const c of fixture.candidates ?? []) {
    const stances = c.top_stances ?? [];
    const votes = c.voting_record ?? [];
    const industries = c.top_industries ?? [];

    // Check 1: stance with low confidence (synthesis flagged uncertainty)
    for (const s of stances) {
      if (typeof s.confidence === 'number' && s.confidence < 60) {
        flags.push({
          candidate: c.name,
          issue_slug: s.issue_slug,
          flag: `Low confidence (${s.confidence}/100). Manual review needed.`,
          severity: 'warning',
        });
      }
    }

    // Check 2: track-record note mentions a specific bill or statement
    // without listing it in citations. The note text should reference real
    // bill_ids (e.g. "voted NAY on hres1189-119") — extract any plausible
    // bill_id mentions and confirm each one is in track_record_citations.
    //
    // Notes that DENY contradiction ("no contradictory votes", "no record")
    // shouldn't fire. The /contradict/i match alone wasn't discriminating
    // enough — pair the contradiction-keyword check with a negation guard
    // and require an explicit bill-like reference before flagging.
    for (const s of stances) {
      const note = s.track_record_note ?? '';
      if (!note) continue;

      // Negation guard: notes that explicitly deny contradiction are fine
      if (/^\s*(no |none |0 )/i.test(note) || /no (contradictory|relevant|specific) (vote|bill|record)/i.test(note)) {
        continue;
      }

      // Pull anything that looks like a bill ID from the note text:
      //   hr7567-119, hres1224-119, s4465-119, sjres184-119, sconres33-119
      //   H.R. 7567, H.Res. 1224, S. 4465
      const billIdRefs = [
        ...note.matchAll(/\b(h\.?r\.?\s*\d+|h\.?res\.?\s*\d+|s\.?\s*\d+|s\.?res\.?\s*\d+|sjres\s*\d+|hjres\s*\d+|s\.?con\.?res\.?\s*\d+|h\.?con\.?res\.?\s*\d+|hr\d+|hres\d+|s\d+|sres\d+|hjres\d+|sjres\d+|hconres\d+|sconres\d+)(-\d+)?/gi),
      ].map((m) => m[0]);

      const citations = s.track_record_citations ?? [];
      if (billIdRefs.length > 0 && citations.length === 0) {
        flags.push({
          candidate: c.name,
          issue_slug: s.issue_slug,
          flag: `Note references bills (${billIdRefs.slice(0, 3).join(', ')}) but track_record_citations is empty.`,
          severity: 'high',
        });
        continue;
      }

      // Also flag contradiction-keyword notes with no citations at all
      // (catches "voted NAY despite stance" without specific bill ref).
      //
      // Exception: donor/industry-based contradictions cite top_industries
      // data, not bill_ids — those legitimately have no track_record_citations.
      // The donor data IS the source; the contradiction is between stated
      // stance and the candidate's own funding profile, which renders inline
      // in the scorecard's "Funded by" section so the user can verify.
      const isDonorContradiction =
        /donor|industry|contribut|pac|funding|funded|fundrais/i.test(note);
      if (
        /contradict|despite\b|⚠/i.test(note) &&
        citations.length === 0 &&
        !isDonorContradiction
      ) {
        flags.push({
          candidate: c.name,
          issue_slug: s.issue_slug,
          flag: `Contradiction note "${note.slice(0, 100)}" lacks citation.`,
          severity: 'high',
        });
      }
    }

    // Check 3: candidate has voting record on issue but no stance synthesized
    const issuesInVotes = new Set<string>();
    for (const v of votes) {
      for (const slug of v.issue_slugs ?? []) issuesInVotes.add(slug);
    }
    const issuesInStances = new Set(stances.map((s: { issue_slug: string }) => s.issue_slug));
    for (const issue of issuesInVotes) {
      if (!issuesInStances.has(issue)) {
        flags.push({
          candidate: c.name,
          issue_slug: issue,
          flag: `Has voting record on this issue but no stance synthesized.`,
          severity: 'info',
        });
      }
    }

    // Check 4: top donor industry that contradicts a stance topic
    const industryNames = (industries as Array<{ industry_name: string }>)
      .slice(0, 5)
      .map((i) => i.industry_name.toLowerCase());
    const contradictionMap: Record<string, string[]> = {
      climate: ['oil & gas', 'coal mining', 'electric utilities'],
      healthcare: ['pharmaceuticals/health products', 'health professionals', 'health services'],
      taxes: ['securities & investment'],
    };
    for (const s of stances) {
      const conflicts = contradictionMap[s.issue_slug];
      if (!conflicts) continue;
      for (const i of industryNames) {
        if (conflicts.some((c) => i.includes(c.toLowerCase()))) {
          flags.push({
            candidate: c.name,
            issue_slug: s.issue_slug,
            flag: `Top donor industry "${i}" potentially conflicts with stated stance.`,
            severity: 'warning',
          });
        }
      }
    }
  }

  if (flags.length === 0) {
    console.log('✅ No inconsistencies flagged. Fixture looks clean.');
    return;
  }

  const bySeverity: Record<string, FlagResult[]> = { high: [], warning: [], info: [] };
  for (const f of flags) bySeverity[f.severity].push(f);

  console.log(`\nFound ${flags.length} flag(s):\n`);
  for (const sev of ['high', 'warning', 'info'] as const) {
    if (bySeverity[sev].length === 0) continue;
    const icon = sev === 'high' ? '🔴' : sev === 'warning' ? '⚠' : 'ℹ';
    console.log(`${icon} ${sev.toUpperCase()} (${bySeverity[sev].length})`);
    for (const f of bySeverity[sev]) {
      console.log(`   ${f.candidate} / ${f.issue_slug}: ${f.flag}`);
    }
    console.log('');
  }

  if (bySeverity.high.length > 0) {
    console.error('🛑 HIGH-severity flags present. Fix before activating.');
    process.exit(2);
  }
}

main();
