// Tests for the shared name-handling helpers (src/lib/api-clients/names.ts).
// Targets Phase 2D-ter §18 bug fixes:
//   - normalizeFecName must preserve internal capitalization in Mc/Mac/O'
//     surnames (Cherfilus-McCormick regression).
//   - stripTitles must remove courtesy tokens but keep legitimate
//     single-letter middle initials.
// Targets T08 (2026-08-06, DATA-AUDIT-2026-08-06 root cause 3 #1):
//   - normalizeFecName must never leak a title/honorific/suffix token into
//     the display name (and therefore never into a slug built from it),
//     for every placement FEC uses (leading/trailing in either the
//     last-name or first/middle segment). Known bad outputs before the
//     fix: "Rick Sen Scott", "Scott Mr. Franklin".

import { describe, it, expect } from 'vitest';
import { normalizeFecName, stripTitles } from '@/lib/api-clients/names';

describe('normalizeFecName', () => {
  describe('LAST, FIRST → First Last transformation', () => {
    it('basic case', () => {
      expect(normalizeFecName('SMITH, JOHN')).toBe('John Smith');
    });

    it('preserves middle name', () => {
      expect(normalizeFecName('FROST, MAXWELL ALEJANDRO')).toBe(
        'Maxwell Alejandro Frost',
      );
    });

    it('returns input unchanged when no comma (already-normalized)', () => {
      expect(normalizeFecName('John Smith')).toBe('John Smith');
    });

    it('collapses multiple spaces', () => {
      expect(normalizeFecName('SMITH,   JOHN  Q')).toBe('John Q Smith');
    });
  });

  describe('Mc prefix preservation (the original Cherfilus regression)', () => {
    it('CHERFILUS-MCCORMICK → Cherfilus-McCormick', () => {
      expect(normalizeFecName('CHERFILUS-MCCORMICK, SHEILA')).toBe(
        'Sheila Cherfilus-McCormick',
      );
    });

    it('MCCORMICK → McCormick', () => {
      expect(normalizeFecName('MCCORMICK, ALICE')).toBe('Alice McCormick');
    });

    it('MCCARTHY → McCarthy', () => {
      expect(normalizeFecName('MCCARTHY, KEVIN')).toBe('Kevin McCarthy');
    });

    it('MCDANIEL → McDaniel', () => {
      expect(normalizeFecName('MCDANIEL, RONNA')).toBe('Ronna McDaniel');
    });
  });

  describe('Mac prefix preservation (conservative — only fires on 4+ trailing chars)', () => {
    it('MACDONALD → MacDonald', () => {
      expect(normalizeFecName('MACDONALD, IAN')).toBe('Ian MacDonald');
    });

    it('MACKENZIE → MacKenzie', () => {
      expect(normalizeFecName('MACKENZIE, ANNA')).toBe('Anna MacKenzie');
    });

    it('MACY stays Macy (too short — not a Scottish surname)', () => {
      expect(normalizeFecName('MACY, JOHN')).toBe('John Macy');
    });

    it('MACK stays Mack (too short)', () => {
      expect(normalizeFecName('MACK, CONNIE')).toBe('Connie Mack');
    });

    it('MACEDO stays Macedo (Portuguese surname, only 3 trailing chars)', () => {
      expect(normalizeFecName('MACEDO, JOAO')).toBe('Joao Macedo');
    });
  });

  describe("O' prefix preservation", () => {
    it("O'CONNOR → O'Connor", () => {
      expect(normalizeFecName("O'CONNOR, KATE")).toBe("Kate O'Connor");
    });

    it("O'ROURKE → O'Rourke", () => {
      expect(normalizeFecName("O'ROURKE, BETO")).toBe("Beto O'Rourke");
    });
  });

  describe('Hyphenated surnames (existing path, regression guard)', () => {
    it('SMITH-JONES → Smith-Jones', () => {
      expect(normalizeFecName('SMITH-JONES, ALEX')).toBe('Alex Smith-Jones');
    });
  });

  describe('T08: known bad outputs from DATA-AUDIT-2026-08-06', () => {
    it('"SCOTT, RICK SEN" no longer produces "Rick Sen Scott"', () => {
      const result = normalizeFecName('SCOTT, RICK SEN');
      expect(result).toBe('Rick Scott');
      expect(result).not.toBe('Rick Sen Scott');
    });

    it('"FRANKLIN, SCOTT MR." no longer produces "Scott Mr. Franklin"', () => {
      const result = normalizeFecName('FRANKLIN, SCOTT MR.');
      expect(result).toBe('Scott Franklin');
      expect(result).not.toBe('Scott Mr. Franklin');
    });
  });

  describe('T08: title/honorific/suffix placement variants', () => {
    // One raw-FEC-style input per class, title placed in the first/middle
    // segment (the common FEC pattern: "LAST, FIRST TITLE").
    const titleInFirstSegment: Array<[string, string]> = [
      ['SCOTT, RICK SEN', 'Rick Scott'], // Sen
      ['SMITH, JOHN REP', 'John Smith'], // Rep
      ['FRANKLIN, SCOTT MR.', 'Scott Franklin'], // Mr
      ['OFFUTT, COURTNEY MS', 'Courtney Offutt'], // Ms
      ['DOE, JANE MRS', 'Jane Doe'], // Mrs
      ['WHITE, VIBERT DR', 'Vibert White'], // Dr
      ['TOULME, ALIX CHRISTOPHER JR.', 'Alix Christopher Toulme'], // Jr, mid-segment
      ['SMITH, JOHN SR', 'John Smith'], // Sr
      ['SMITH, JOHN III', 'John Smith'], // III
    ];
    it.each(titleInFirstSegment)('%s → %s', (input, expected) => {
      expect(normalizeFecName(input)).toBe(expected);
    });

    // Title placed in the last-name segment (before the comma) — the
    // pattern behind "Vibert Dr White"-style leaks.
    const titleInLastSegment: Array<[string, string]> = [
      ['SCOTT SEN, RICK', 'Rick Scott'], // Sen
      ['SMITH REP, JOHN', 'John Smith'], // Rep
      ['FRANKLIN MR, SCOTT', 'Scott Franklin'], // Mr
      ['SMITH JR, JOHN', 'John Smith'], // Jr
      ['SMITH SR, JOHN', 'John Smith'], // Sr
      ['SMITH III, JOHN', 'John Smith'], // III
    ];
    it.each(titleInLastSegment)('%s → %s', (input, expected) => {
      expect(normalizeFecName(input)).toBe(expected);
    });

    it('strips Rev. (real fixture case: "Ernest Ernie John Rev. Dr. Rivera")', () => {
      expect(normalizeFecName('RIVERA, ERNEST ERNIE JOHN REV. DR.')).toBe(
        'Ernest Ernie John Rivera',
      );
    });

    it('strips a trailing-comma degree suffix chain (real fixture case: "Nizam Md, Jd Razack")', () => {
      // FEC sometimes chains multiple suffixes after a second comma; the
      // regex only splits on the first comma, so the leftover "MD," token
      // must still be recognized once its trailing comma is stripped.
      expect(normalizeFecName('RAZACK, NIZAM MD, JD')).toBe('Nizam Razack');
    });

    it('a title-leaked display name fed back in (no comma) still gets cleaned', () => {
      // Defense in depth: even if a title reaches normalizeFecName a
      // second time via some other already-normalized-name path, it must
      // not survive.
      expect(normalizeFecName('Rick Sen Scott')).toBe('Rick Scott');
      expect(normalizeFecName('Scott Mr. Franklin')).toBe('Scott Franklin');
    });

    it('does not strip legitimate single-letter or two-letter middle initials', () => {
      expect(normalizeFecName('CAMPBELL, WALTER L DR.')).toBe('Walter L Campbell');
    });
  });

  describe('T08: slug built from normalizeFecName output never carries a title token', () => {
    // Mirrors the slug expression in scripts/ingest/fetch_fec.ts
    // (normalizeFecName(...).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')).
    function slugify(name: string): string {
      return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    }

    const knownBadRawInputs = [
      'CARTER, GREGORY MARCUS MR',
      'CHALIFOUX, THOMAS E. COLONEL JR.',
      'WHITE DR, VIBERT',
      'WEBSTER, ROYAL MR.',
      'ROBINSON, TIMOTHY BRANDT MR',
      'OFFUTT, COURTNEY MS',
      'PEARSON, GLENN KEITH MR',
      'POPE, EDWARD PETER DR.',
      'CAMPBELL, WALTER L DR.',
      'FRANKLIN, SCOTT MR.',
      'OBERWEIS, JAMES MR.',
      'CAMPBELL, LUTHER MR.',
      'MOISE, RUDOLPH DR.',
      'JOSEPH, RODENAY MR.',
      'TANEJA PERRY, NEELAM DR',
      'ORTIZ, RAFAEL ARTURO MR.',
      'HENRY, JAMES F MR.',
      'LYLES, TAMIKA MS',
      'STEVENS, DENNIS GENE MR',
      'RIVERA, ERNEST ERNIE JOHN REV. DR.',
      'SCOTT, RICK SEN',
      'TOULME, ALIX CHRISTOPHER MR. JR.',
    ];

    it.each(knownBadRawInputs)('slug for "%s" has no leaked title token', (raw) => {
      const slug = slugify(normalizeFecName(raw));
      const titleTokens = [
        'mr', 'mrs', 'ms', 'dr', 'sen', 'rep', 'hon', 'rev', 'reverend',
        'col', 'colonel', 'jr', 'sr', 'ii', 'iii', 'iv', 'esq', 'phd',
        'md', 'jd', 'od',
      ];
      const parts = slug.split('-');
      for (const t of titleTokens) {
        expect(parts).not.toContain(t);
      }
    });
  });
});

describe('stripTitles', () => {
  it('strips Mr.', () => {
    expect(stripTitles('Scott Mr. Franklin')).toBe('Scott Franklin');
  });

  it('strips Dr. and keeps single-letter middle initial', () => {
    expect(stripTitles('Walter L Dr. Campbell')).toBe('Walter L Campbell');
  });

  it('strips Jr. and Mr.', () => {
    expect(stripTitles('Royal Mr. Webster Jr.')).toBe('Royal Webster');
  });

  it('leaves plain names unchanged', () => {
    expect(stripTitles('Maxwell Frost')).toBe('Maxwell Frost');
  });

  it('handles hyphenated surnames unchanged', () => {
    expect(stripTitles('Sheila Cherfilus-McCormick')).toBe(
      'Sheila Cherfilus-McCormick',
    );
  });

  it('strips Colonel and Jr.', () => {
    expect(stripTitles('Thomas E. Colonel Jr. Chalifoux')).toBe(
      'Thomas E. Chalifoux',
    );
  });

  it('strips Sen and Hon (case-insensitive)', () => {
    expect(stripTitles('Marco Sen Rubio')).toBe('Marco Rubio');
    expect(stripTitles('Pat Hon Toomey')).toBe('Pat Toomey');
  });

  it('strips PhD, MD, Esq', () => {
    expect(stripTitles('Jane Smith MD')).toBe('Jane Smith');
    expect(stripTitles('John Doe Esq')).toBe('John Doe');
  });

  it('strips Rev., JD, and OD (T08 additions found in the audit fixtures)', () => {
    expect(stripTitles('Ernest Ernie John Rev. Dr. Rivera')).toBe(
      'Ernest Ernie John Rivera',
    );
    expect(stripTitles('Nizam MD JD Razack')).toBe('Nizam Razack');
    expect(stripTitles('Vibert OD Wertheim')).toBe('Vibert Wertheim');
  });

  it('strips a trailing-comma title token (T08: multi-suffix chain)', () => {
    expect(stripTitles('Nizam MD, JD Razack')).toBe('Nizam Razack');
  });
});
