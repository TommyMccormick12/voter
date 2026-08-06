import { describe, it, expect } from 'vitest';
import { getPartyTheme, getPartyInitials } from '@/lib/party-theme';
import { PARTY_PALETTE, PARTY_LABEL, resolvePartyKey } from '@/lib/tokens';

describe('resolvePartyKey', () => {
  it('maps R/D and lowercase variants to the right key', () => {
    expect(resolvePartyKey('R')).toBe('R');
    expect(resolvePartyKey('r')).toBe('R');
    expect(resolvePartyKey('Republican')).toBe('R');
    expect(resolvePartyKey('D')).toBe('D');
    expect(resolvePartyKey('democrat')).toBe('D');
  });

  it('falls back to Independent for null, undefined, empty, or unrecognized values', () => {
    expect(resolvePartyKey(null)).toBe('I');
    expect(resolvePartyKey(undefined)).toBe('I');
    expect(resolvePartyKey('')).toBe('I');
    expect(resolvePartyKey('Green')).toBe('I');
    expect(resolvePartyKey('I')).toBe('I');
  });
});

describe('getPartyTheme', () => {
  it('returns the theme whose industryFill/label come from PARTY_PALETTE/PARTY_LABEL — no hand-duplicated hex', () => {
    const r = getPartyTheme('R');
    expect(r.industryFill).toBe(PARTY_PALETTE.R[600]);
    expect(r.label).toBe(PARTY_LABEL.R);

    const d = getPartyTheme('D');
    expect(d.industryFill).toBe(PARTY_PALETTE.D[600]);
    expect(d.label).toBe(PARTY_LABEL.D);

    const i = getPartyTheme('Independent');
    expect(i.industryFill).toBe(PARTY_PALETTE.I[600]);
    expect(i.label).toBe(PARTY_LABEL.I);
  });

  it('falls back to the Independent theme for unrecognized/missing party', () => {
    expect(getPartyTheme(null)).toEqual(getPartyTheme('I'));
    expect(getPartyTheme('Green')).toEqual(getPartyTheme('I'));
  });
});

describe('getPartyInitials', () => {
  it('takes the first letter of the first two words, uppercased', () => {
    expect(getPartyInitials('Jane Doe')).toBe('JD');
    expect(getPartyInitials('maria de la cruz')).toBe('MD');
  });

  it('handles a single-word name', () => {
    expect(getPartyInitials('Cher')).toBe('C');
  });

  it('collapses extra whitespace', () => {
    expect(getPartyInitials('  Jane   Doe  ')).toBe('JD');
  });
});
