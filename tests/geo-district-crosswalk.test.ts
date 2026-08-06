// Tests for the 2026 FL congressional district lookup modules (T04/T05,
// SPEC-2026-08-06.md A3). Runs against the real committed data files
// (supabase/seed/geo/fl-congress-2026.geojson,
// supabase/seed/zip-districts-2026.json) — these ARE the artifacts the
// A3 accept criterion checks, so testing against fixtures would miss
// exactly the bug class this ticket exists to fix.

import { describe, it, expect } from 'vitest';
import { lookupZipDistricts } from '@/lib/geo/crosswalk';
import { districtForPoint } from '@/lib/geo/districts';

describe('geo/crosswalk: lookupZipDistricts', () => {
  it('returns null for a ZIP outside the crosswalk (non-FL / no coverage)', () => {
    expect(lookupZipDistricts('90210')).toBeNull(); // Beverly Hills, CA
    expect(lookupZipDistricts('10001')).toBeNull(); // New York, NY
  });

  it('33142 (Miami) resolves to exactly the two districts the audit flagged (FL-24/FL-26)', () => {
    // DATA-AUDIT-2026-08-06.md root cause 4: the old crosswalk sent 33142 to
    // FL-26 though 71% was FL-24 -- but that finding was against the
    // PRE-2026 map. Under the redrawn EOGPCRP2026 map this ZIP is still
    // split between the same two districts; validation_results in the
    // final report records which one is majority on the new map.
    const entries = lookupZipDistricts('33142');
    expect(entries).not.toBeNull();
    const districts = entries!.map((e) => e.district).sort((a, b) => a - b);
    expect(districts).toEqual([24, 26]);
    const totalShare = entries!.reduce((sum, e) => sum + e.share, 0);
    expect(totalShare).toBeGreaterThan(0.9); // near-total coverage, sanity check
    expect(totalShare).toBeLessThanOrEqual(1.001);
  });

  it('32822 (Orlando) is split across FL-09 and FL-10', () => {
    const entries = lookupZipDistricts('32822');
    expect(entries).not.toBeNull();
    expect(entries!.length).toBeGreaterThanOrEqual(2);
    const districts = entries!.map((e) => e.district).sort((a, b) => a - b);
    expect(districts).toEqual(expect.arrayContaining([9, 10]));
  });

  it('32502 (Pensacola) resolves to a single district, FL-01', () => {
    const entries = lookupZipDistricts('32502');
    expect(entries).toEqual([{ district: 1, share: 1 }]);
  });

  it('every entry has a share in (0.02, 1] — the noise floor is enforced', () => {
    const entries = lookupZipDistricts('33602'); // known split ZIP (Tampa)
    expect(entries).not.toBeNull();
    for (const e of entries!) {
      expect(e.share).toBeGreaterThan(0.02);
      expect(e.share).toBeLessThanOrEqual(1);
    }
  });

  it('entries are sorted by descending share', () => {
    const entries = lookupZipDistricts('33301'); // Fort Lauderdale, split ZIP
    expect(entries).not.toBeNull();
    expect(entries!.length).toBeGreaterThan(1);
    for (let i = 1; i < entries!.length; i++) {
      expect(entries![i - 1].share).toBeGreaterThanOrEqual(entries![i].share);
    }
  });
});

describe('geo/districts: districtForPoint', () => {
  it('resolves a known point inside FL-01 (downtown Pensacola)', () => {
    // Pensacola city hall area, well inside FL-01 on every recent map.
    const district = districtForPoint(-87.2169, 30.4213);
    expect(district).toBe(1);
  });

  it('resolves a known point inside FL-02 (downtown Tallahassee)', () => {
    const district = districtForPoint(-84.2807, 30.4383);
    expect(district).toBe(2);
  });

  it('returns null for a point far outside Florida', () => {
    // Times Square, NYC.
    const district = districtForPoint(-73.9857, 40.758);
    expect(district).toBeNull();
  });

  it('returns null for a point in the Atlantic, well off the coast', () => {
    // ~200km east of Florida's Atlantic coast -- open ocean on every map.
    const district = districtForPoint(-77.5, 27.0);
    expect(district).toBeNull();
  });
});
