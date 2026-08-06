// T18 (Spec D1): src/lib/tokens.ts is the single source of truth for the
// party palette; src/app/globals.css mirrors it as CSS custom properties
// because Tailwind 4 reads CSS at build time and cannot import a TS
// module. This test is the guard against the two silently drifting apart —
// every hex value in PARTY_PALETTE must appear in globals.css tagged with
// the matching --color-party-<key>-<step> custom property.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PARTY_PALETTE, STATUS, RADII } from '@/lib/tokens';

const globalsCss = readFileSync(
  resolve(process.cwd(), 'src/app/globals.css'),
  'utf-8'
);

describe('tokens-sync (globals.css mirrors src/lib/tokens.ts)', () => {
  it('has every party ramp value present at its matching CSS custom property', () => {
    for (const [key, ramp] of Object.entries(PARTY_PALETTE)) {
      const partyKey = key.toLowerCase();
      for (const [step, hex] of Object.entries(ramp)) {
        const varName = `--color-party-${partyKey}-${step}`;
        const pattern = new RegExp(
          `${varName}\\s*:\\s*${hex.replace('#', '#')}\\s*;`,
          'i'
        );
        expect(
          globalsCss,
          `expected ${varName}: ${hex}; in globals.css (tokens.ts PARTY_PALETTE.${key}[${step}])`
        ).toMatch(pattern);
      }
    }
  });

  it('has every status token present at its matching CSS custom property', () => {
    for (const [key, hex] of Object.entries(STATUS)) {
      const varName = `--color-status-${key}`;
      const pattern = new RegExp(`${varName}\\s*:\\s*${hex}\\s*;`, 'i');
      expect(globalsCss, `expected ${varName}: ${hex}; in globals.css`).toMatch(pattern);
    }
  });

  it('has every radius token present at its matching CSS custom property', () => {
    for (const [key, value] of Object.entries(RADII)) {
      const varName = `--radius-${key}`;
      const pattern = new RegExp(
        `${varName}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*;`,
        'i'
      );
      expect(globalsCss, `expected ${varName}: ${value}; in globals.css`).toMatch(pattern);
    }
  });

  it('party-theme.ts and og-helpers.ts hold no hand-typed hex — both import PARTY_PALETTE', () => {
    // Regression guard for the bug this ticket fixes: party-theme.ts and
    // the OG route previously each hand-typed the same party hex values
    // independently. Neither source file should contain a literal hex
    // color anymore — only tokens.ts and globals.css may.
    const partyTheme = readFileSync(
      resolve(process.cwd(), 'src/lib/party-theme.ts'),
      'utf-8'
    );
    const ogHelpers = readFileSync(resolve(process.cwd(), 'src/lib/og-helpers.ts'), 'utf-8');
    const hexPattern = /#[0-9a-fA-F]{3,8}\b/;
    expect(partyTheme).not.toMatch(hexPattern);
    expect(ogHelpers).not.toMatch(hexPattern);
  });
});
