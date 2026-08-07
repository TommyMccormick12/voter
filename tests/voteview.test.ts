// Tests for src/lib/api-clients/voteview.ts (T10 — Senate votes).
//
// Covers the hand-rolled CSV parser (quoted fields with embedded commas
// and escaped quotes — Voteview's vote_desc column needs both), the
// cast_code -> canonical vote mapping, and the bill_id builder. No network
// mocking needed here: parseCsv/normalizeCastCode/billIdFromRollCall are
// pure functions.

import { describe, it, expect } from 'vitest';
import { parseCsv, normalizeCastCode, billIdFromRollCall } from '@/lib/api-clients/voteview';

describe('parseCsv', () => {
  it('parses a simple unquoted CSV', () => {
    const rows = parseCsv('a,b,c\n1,2,3\n4,5,6');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('keeps commas embedded in a quoted field as part of that field', () => {
    const rows = parseCsv('date,desc\n2025-01-09,"A bill to require, and for other purposes."');
    expect(rows).toEqual([
      ['date', 'desc'],
      ['2025-01-09', 'A bill to require, and for other purposes.'],
    ]);
  });

  it('unescapes doubled quotes inside a quoted field', () => {
    const rows = parseCsv('name\n"Eric A. ""Rick"" Crawford"');
    expect(rows).toEqual([['name'], ['Eric A. "Rick" Crawford']]);
  });

  it('handles CRLF line endings', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles a trailing row with no final newline', () => {
    const rows = parseCsv('a,b\n1,2');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('parses an empty field between commas', () => {
    const rows = parseCsv('a,b,c\n1,,3');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });
});

describe('normalizeCastCode (Voteview cast_code convention)', () => {
  it('maps 1-3 to yea (Yea, Paired Yea, Announced Yea)', () => {
    expect(normalizeCastCode(1)).toBe('yea');
    expect(normalizeCastCode(2)).toBe('yea');
    expect(normalizeCastCode(3)).toBe('yea');
  });

  it('maps 4-6 to nay (Announced Nay, Paired Nay, Nay)', () => {
    expect(normalizeCastCode(4)).toBe('nay');
    expect(normalizeCastCode(5)).toBe('nay');
    expect(normalizeCastCode(6)).toBe('nay');
  });

  it('maps 7-8 to present', () => {
    expect(normalizeCastCode(7)).toBe('present');
    expect(normalizeCastCode(8)).toBe('present');
  });

  it('maps 9 to absent (Not Voting)', () => {
    expect(normalizeCastCode(9)).toBe('absent');
  });

  it('maps 0 (not a member) to no_vote rather than throwing', () => {
    expect(normalizeCastCode(0)).toBe('no_vote');
  });
});

describe('billIdFromRollCall', () => {
  it('builds "{type}{number}-{congress}" from a bill_number like "S5"', () => {
    expect(billIdFromRollCall({ bill_number: 'S5', congress: 119 })).toBe('s5-119');
  });

  it('handles multi-letter types like HCONRES14', () => {
    expect(billIdFromRollCall({ bill_number: 'HCONRES14', congress: 119 })).toBe('hconres14-119');
  });

  it('returns null (never the string "undefined") when bill_number is null', () => {
    expect(billIdFromRollCall({ bill_number: null, congress: 119 })).toBeNull();
  });

  it('returns null on an unparseable bill_number rather than emitting a malformed id', () => {
    expect(billIdFromRollCall({ bill_number: '???', congress: 119 })).toBeNull();
  });
});
