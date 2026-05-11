// Tests for the shared name-handling helpers (src/lib/api-clients/names.ts).
// Targets Phase 2D-ter §18 bug fixes:
//   - normalizeFecName must preserve internal capitalization in Mc/Mac/O'
//     surnames (Cherfilus-McCormick regression).
//   - stripTitles must remove courtesy tokens but keep legitimate
//     single-letter middle initials.

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
});
