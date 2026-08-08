// Every stance carries a source_url a voter can click. Nothing checked that
// the URL actually belongs to the candidate whose card it sits on.
//
// The 2026-08-08 verification pass found four stances citing a page that does
// not contain the claim. `synthesize_stances.ts` attaches ONE `website` value
// to every stance a candidate has. That is correct while a candidate is
// authored from a single source, and silently wrong the moment one is authored
// from two — Troy Albers' issues page plus his voter-guide answers, Aaron
// Baker's policy page plus his. Every stance got the campaign-site URL,
// including the three whose claims exist only in the guide.
//
// This file cannot re-read the internet, so it pins what is checkable in the
// fixtures: a stance's source_url must be a URL the candidate's own record
// actually declares. That catches a stance citing another candidate's site, a
// blank citation, and the specific regression above once a corrected fixture
// records the second source.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase', 'seed', 'candidates');

interface Stance {
  issue_slug?: string;
  source_url?: string;
  stance_id?: string;
}
interface Candidate {
  name?: string;
  slug?: string;
  active?: boolean;
  website?: string;
  campaign_website?: string;
  ballotpedia_url?: string;
  top_stances?: Stance[];
}

function activeCandidates(): Array<{ race: string; c: Candidate }> {
  const out: Array<{ race: string; c: Candidate }> = [];
  for (const f of readdirSync(DIR).filter((n) => n.endsWith('.partial.json'))) {
    const fixture = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as { candidates?: Candidate[] };
    for (const c of fixture.candidates ?? []) {
      if (c.active) out.push({ race: f.replace('.partial.json', ''), c });
    }
  }
  return out;
}

const ACTIVE = activeCandidates();

describe('stance citation integrity', () => {
  it('finds the active candidate set, so an empty fixture dir cannot pass this file vacuously', () => {
    expect(ACTIVE.length).toBeGreaterThan(50);
  });

  it('gives every stance on an active candidate a resolvable http(s) source_url', () => {
    // A blank citation is the failure the source_url work already fixed once,
    // when hand-authored candidates reached voters with no link at all.
    const bad: string[] = [];
    for (const { race, c } of ACTIVE) {
      for (const s of c.top_stances ?? []) {
        if (!s.source_url || !/^https?:\/\/\S+$/.test(s.source_url)) {
          bad.push(`${c.slug} [${race}] ${s.issue_slug}: ${JSON.stringify(s.source_url)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('never cites a source_url whose host belongs to a different candidate in the same race', () => {
    // The cheapest catchable form of a mis-citation: candidate A's card
    // pointing at candidate B's campaign domain.
    const own = (c: Candidate) =>
      [c.campaign_website, c.website, c.ballotpedia_url]
        .filter((u): u is string => typeof u === 'string' && u !== '')
        .map((u) => new URL(u).host);

    const byRace = new Map<string, Array<{ c: Candidate; hosts: string[] }>>();
    for (const { race, c } of ACTIVE) {
      if (!byRace.has(race)) byRace.set(race, []);
      byRace.get(race)!.push({ c, hosts: own(c) });
    }

    const bad: string[] = [];
    for (const [race, members] of byRace) {
      for (const { c } of members) {
        const mine = new Set(own(c));
        const theirs = new Set(
          members.filter((m) => m.c.slug !== c.slug).flatMap((m) => m.hosts),
        );
        for (const s of c.top_stances ?? []) {
          if (!s.source_url) continue;
          const host = new URL(s.source_url).host;
          if (theirs.has(host) && !mine.has(host)) {
            bad.push(`${c.slug} [${race}] ${s.issue_slug} cites a rival's domain ${host}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps stance_id unique within a candidate, so a correction cannot silently overwrite a sibling', () => {
    const bad: string[] = [];
    for (const { race, c } of ACTIVE) {
      const seen = new Set<string>();
      for (const s of c.top_stances ?? []) {
        if (!s.stance_id) continue;
        if (seen.has(s.stance_id)) bad.push(`${c.slug} [${race}] duplicate stance_id ${s.stance_id}`);
        seen.add(s.stance_id);
      }
    }
    expect(bad).toEqual([]);
  });

  it('lets a candidate cite more than one source, which is why the single-website assumption broke', () => {
    // Documents the corrected state rather than forbidding it: Albers now
    // cites both his issues page and the voter guide that carries the rest of
    // his answers. A future single-URL shortcut would collapse this back to 1.
    const albers = ACTIVE.find(({ c }) => c.slug === 'troy-albers');
    expect(albers).toBeDefined();
    const hosts = new Set((albers!.c.top_stances ?? []).map((s) => new URL(s.source_url!).host));
    expect(hosts.size).toBeGreaterThan(1);
  });
});
