import { describe, it, expect } from 'vitest';
import { pickOgParty, ogInitials, clampOgScore } from '@/lib/og-helpers';
import { PARTY_PALETTE, PARTY_LABEL } from '@/lib/tokens';

describe('pickOgParty', () => {
  it('builds the OG palette from PARTY_PALETTE — no hand-duplicated hex', () => {
    const r = pickOgParty('R');
    expect(r.bandFrom).toBe(PARTY_PALETTE.R[50]);
    expect(r.bandTo).toBe(PARTY_PALETTE.R[200]);
    expect(r.accent).toBe(PARTY_PALETTE.R[800]);
    expect(r.avatarFrom).toBe(PARTY_PALETTE.R[400]);
    expect(r.avatarTo).toBe(PARTY_PALETTE.R[600]);
    expect(r.label).toBe(PARTY_LABEL.R);
  });

  it('falls back to Independent for null/unrecognized party', () => {
    expect(pickOgParty(null)).toEqual(pickOgParty('I'));
    expect(pickOgParty('Green')).toEqual(pickOgParty('I'));
  });
});

describe('ogInitials', () => {
  it('returns up to two uppercase initials', () => {
    expect(ogInitials('Jane Doe')).toBe('JD');
    expect(ogInitials('cher')).toBe('C');
  });
});

describe('clampOgScore', () => {
  it('parses a valid integer string', () => {
    expect(clampOgScore('82')).toBe(82);
  });

  it('clamps out-of-range values into 0-100', () => {
    expect(clampOgScore('150')).toBe(100);
    expect(clampOgScore('-5')).toBe(0);
  });

  it('returns null for missing or unparseable input', () => {
    expect(clampOgScore(null)).toBeNull();
    expect(clampOgScore('')).toBeNull();
    expect(clampOgScore('not-a-number')).toBeNull();
  });
});
