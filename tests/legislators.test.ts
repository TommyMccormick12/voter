// Tests for the unitedstates/congress-legislators ID crosswalk
// (src/lib/api-clients/legislators.ts).
//
// Covers:
//   - parseYaml against the actual block-style idioms legislators-current.yaml
//     uses (nested maps, same-indent sequences, quoted scalars, lists of
//     scalars, lists of maps) — this is hand-rolled parsing code with no
//     library backstop, so it's the highest-risk piece of the crosswalk.
//   - buildFecToBioguideIndex: the ID-only reverse lookup fetch_votes.ts
//     actually uses. No name is read anywhere in this file.
//   - selectFecCandidateId: the pure "id.fec is a list — pick the H/S entry
//     whose election_years contains the target year" rule from spec B2.

import { describe, it, expect } from 'vitest';
import {
  parseYaml,
  buildFecToBioguideIndex,
  findByBioguide,
  selectFecCandidateId,
  type Legislator,
  type FecCandidateOption,
} from '@/lib/api-clients/legislators';

describe('parseYaml', () => {
  it('parses a top-level sequence of mappings with a nested-deeper map value', () => {
    const yaml = [
      '- id:',
      '    bioguide: C000127',
      '    thomas: \'00172\'',
      '  name:',
      '    first: Maria',
      '    last: Cantwell',
    ].join('\n');
    const parsed = parseYaml(yaml) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: { bioguide: 'C000127', thomas: '00172' },
      name: { first: 'Maria', last: 'Cantwell' },
    });
  });

  it('parses a same-indent block sequence value (the terms:/family: idiom)', () => {
    // legislators-current.yaml consistently writes sequence values at the
    // SAME indent as their key, not deeper:
    //   terms:
    //   - type: rep
    //     start: '1993-01-05'
    const yaml = [
      '- id:',
      '    bioguide: C000127',
      '  terms:',
      '  - type: rep',
      "    start: '1993-01-05'",
      '    state: WA',
      '  - type: sen',
      "    start: '2001-01-03'",
      '    state: WA',
    ].join('\n');
    const parsed = parseYaml(yaml) as Array<Record<string, unknown>>;
    const terms = parsed[0].terms as Array<Record<string, unknown>>;
    expect(terms).toHaveLength(2);
    expect(terms[0]).toMatchObject({ type: 'rep', start: '1993-01-05', state: 'WA' });
    expect(terms[1]).toMatchObject({ type: 'sen', start: '2001-01-03', state: 'WA' });
  });

  it('parses a list of plain scalars (the id.fec idiom)', () => {
    const yaml = ['- id:', '    bioguide: C000127', '    fec:', '    - S8WA00194', '    - H2WA01054'].join(
      '\n',
    );
    const parsed = parseYaml(yaml) as Array<Record<string, unknown>>;
    const id = parsed[0].id as Record<string, unknown>;
    expect(id.fec).toEqual(['S8WA00194', 'H2WA01054']);
  });

  it('keeps quoted numeric-looking strings as strings (thomas ids, zero-padded)', () => {
    const yaml = ['- id:', "    thomas: '00172'"].join('\n');
    const parsed = parseYaml(yaml) as Array<Record<string, unknown>>;
    const id = parsed[0].id as Record<string, unknown>;
    expect(id.thomas).toBe('00172');
    expect(typeof id.thomas).toBe('string');
  });

  it('parses unquoted numbers as numbers', () => {
    const yaml = ['- id:', '    govtrack: 300018'].join('\n');
    const parsed = parseYaml(yaml) as Array<Record<string, unknown>>;
    const id = parsed[0].id as Record<string, unknown>;
    expect(id.govtrack).toBe(300018);
    expect(typeof id.govtrack).toBe('number');
  });

  it('parses null (~) and preserves embedded double quotes in unquoted scalars', () => {
    const yaml = ['- id:', '    bioguide: C000127', '  fax: ~', '  nickname: Eric A. "Rick" Crawford'].join(
      '\n',
    );
    const parsed = parseYaml(yaml) as Array<Record<string, unknown>>;
    expect(parsed[0].fax).toBeNull();
    expect(parsed[0].nickname).toBe('Eric A. "Rick" Crawford');
  });

  it('parses multiple top-level records independently', () => {
    const yaml = [
      '- id:',
      '    bioguide: C000127',
      '  name:',
      '    last: Cantwell',
      '- id:',
      '    bioguide: F000476',
      '  name:',
      '    last: Frost',
    ].join('\n');
    const parsed = parseYaml(yaml) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(2);
    expect((parsed[0].id as Record<string, unknown>).bioguide).toBe('C000127');
    expect((parsed[1].id as Record<string, unknown>).bioguide).toBe('F000476');
  });
});

function legislator(bioguide: string, fec: string[]): Legislator {
  return {
    id: { bioguide, fec },
    name: { first: 'Test', last: 'Person' },
    terms: [],
  };
}

describe('buildFecToBioguideIndex (ID-only reverse lookup — no name matching)', () => {
  it('maps every fec id in a legislator id.fec list to their bioguide', () => {
    const legislators = [legislator('C000127', ['S8WA00194', 'H2WA01054'])];
    const index = buildFecToBioguideIndex(legislators);
    expect(index.get('S8WA00194')).toBe('C000127');
    expect(index.get('H2WA01054')).toBe('C000127');
  });

  it('does not collide across legislators with disjoint fec ids', () => {
    const legislators = [
      legislator('C000127', ['S8WA00194']),
      legislator('F000476', ['H2FL10259']),
    ];
    const index = buildFecToBioguideIndex(legislators);
    expect(index.get('S8WA00194')).toBe('C000127');
    expect(index.get('H2FL10259')).toBe('F000476');
    expect(index.size).toBe(2);
  });

  it('an unrecognized fec id (challenger, no bioguide) is simply absent — never falls back to a name guess', () => {
    const legislators = [legislator('C000127', ['S8WA00194'])];
    const index = buildFecToBioguideIndex(legislators);
    expect(index.get('H6FL13999')).toBeUndefined();
  });

  it('handles a legislator with no fec ids at all', () => {
    const legislators = [legislator('X000000', [])];
    const index = buildFecToBioguideIndex(legislators);
    expect(index.size).toBe(0);
  });
});

describe('findByBioguide', () => {
  it('finds by exact bioguide match', () => {
    const legislators = [legislator('C000127', []), legislator('F000476', [])];
    expect(findByBioguide(legislators, 'F000476')?.id.bioguide).toBe('F000476');
  });

  it('returns null on no match', () => {
    const legislators = [legislator('C000127', [])];
    expect(findByBioguide(legislators, 'ZZZ0000')).toBeNull();
  });
});

describe('selectFecCandidateId (spec B2: "id.fec is a list — pick the H/S entry with 2026 in election_years")', () => {
  it('picks the House entry whose election_years contains the target year', () => {
    const options: FecCandidateOption[] = [
      { candidateId: 'S8WA00194', office: 'S', electionYears: [2000, 2006, 2012, 2018, 2024] },
      { candidateId: 'H2WA01054', office: 'H', electionYears: [1992] },
    ];
    expect(selectFecCandidateId(options, 'S', 2024)).toBe('S8WA00194');
  });

  it('picks the Senate entry for a Senate election year, ignoring an old House entry', () => {
    const options: FecCandidateOption[] = [
      { candidateId: 'H2FL08208', office: 'H', electionYears: [2018, 2020, 2022, 2024] },
      { candidateId: 'S6FL00445', office: 'S', electionYears: [2018] },
    ];
    // A House member running for Senate in a new cycle: only the Senate
    // entry for that specific year should be picked.
    expect(selectFecCandidateId(options, 'S', 2018)).toBe('S6FL00445');
    expect(selectFecCandidateId(options, 'H', 2018)).toBe('H2FL08208');
  });

  it('returns null when office matches but the year does not', () => {
    const options: FecCandidateOption[] = [
      { candidateId: 'H2FL08208', office: 'H', electionYears: [2018, 2020, 2022] },
    ];
    expect(selectFecCandidateId(options, 'H', 2026)).toBeNull();
  });

  it('returns null when the year matches but the office does not', () => {
    const options: FecCandidateOption[] = [
      { candidateId: 'H2FL08208', office: 'H', electionYears: [2026] },
    ];
    expect(selectFecCandidateId(options, 'S', 2026)).toBeNull();
  });

  it('returns null on an empty options list', () => {
    expect(selectFecCandidateId([], 'H', 2026)).toBeNull();
  });

  it('ignores a Presidential-office entry even if the year matches', () => {
    const options: FecCandidateOption[] = [
      { candidateId: 'P00000001', office: 'P', electionYears: [2026] },
    ];
    expect(selectFecCandidateId(options, 'H', 2026)).toBeNull();
    expect(selectFecCandidateId(options, 'S', 2026)).toBeNull();
  });
});
