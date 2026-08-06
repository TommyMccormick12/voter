// Tests for the 2026 FL congressional district lookup modules (T04/T05,
// SPEC-2026-08-06.md A3). Runs against the real committed data files
// (supabase/seed/geo/fl-congress-2026.geojson,
// supabase/seed/zip-districts-2026.json) — these ARE the artifacts the
// A3 accept criterion checks, so testing against fixtures would miss
// exactly the bug class this ticket exists to fix.
//
// The crosswalk is POPULATION-weighted (2020 Census block population), not
// area-weighted — see scripts/ingest/build_zip_crosswalk.ts header comment
// and DATA-AUDIT-2026-08-06.md. An adversarial verification pass found the
// old area-weighted file wrong two ways: a 2% area noise floor silently
// dropped three genuinely split ZIPs to single-district (33955, 32826,
// 33849), and area shares inverted reality for ZIPs where an unpopulated
// area (an airport, in 33142's case) dominates the land but not the
// population. The tests below pin the corrected numbers so a future rebuild
// can't silently regress either bug.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { lookupZipDistricts } from '@/lib/geo/crosswalk';
import { districtForPoint } from '@/lib/geo/districts';

const CROSSWALK_META_PATH = join(
  process.cwd(),
  'supabase',
  'seed',
  'zip-districts-2026.meta.json',
);

describe('geo/crosswalk: lookupZipDistricts', () => {
  it('returns null for a ZIP outside the crosswalk (non-FL / no coverage)', () => {
    expect(lookupZipDistricts('90210')).toBeNull(); // Beverly Hills, CA
    expect(lookupZipDistricts('10001')).toBeNull(); // New York, NY
  });

  it('33955 resolves as a genuine split, D17 majority / D19 minority (was silently single-district on the area-based file)', () => {
    const entries = lookupZipDistricts('33955');
    expect(entries).not.toBeNull();
    expect(entries).toHaveLength(2);
    expect(entries![0].district).toBe(17);
    expect(entries![0].share).toBeCloseTo(0.805, 2);
    expect(entries![1].district).toBe(19);
    expect(entries![1].share).toBeCloseTo(0.195, 2);
  });

  it('32826 resolves as a genuine split, D8 majority / D10 minority (was silently single-district on the area-based file)', () => {
    const entries = lookupZipDistricts('32826');
    expect(entries).not.toBeNull();
    expect(entries).toHaveLength(2);
    expect(entries![0].district).toBe(8);
    expect(entries![0].share).toBeCloseTo(0.925, 2);
    expect(entries![1].district).toBe(10);
    expect(entries![1].share).toBeCloseTo(0.075, 2);
  });

  it('33849 resolves as a genuine split, D18 majority / D15 minority (was silently single-district on the area-based file)', () => {
    const entries = lookupZipDistricts('33849');
    expect(entries).not.toBeNull();
    expect(entries).toHaveLength(2);
    expect(entries![0].district).toBe(18);
    expect(entries![0].share).toBeCloseTo(0.921, 2);
    expect(entries![1].district).toBe(15);
    expect(entries![1].share).toBeCloseTo(0.079, 2);
  });

  it('33142 (Miami) puts FL-24 first by POPULATION even though FL-26 (the airport) is the area majority', () => {
    // The area-weighted file put FL-26 first here — 33142's land area is
    // majority airport, but ~91% of its ~55k residents live in FL-24.
    // entries[0] must reflect population, not area.
    const entries = lookupZipDistricts('33142');
    expect(entries).not.toBeNull();
    expect(entries!.length).toBeGreaterThanOrEqual(2);
    expect(entries![0].district).toBe(24);
    expect(entries![0].share).toBeCloseTo(0.907, 2);
    const totalShare = entries!.reduce((sum, e) => sum + e.share, 0);
    expect(totalShare).toBeGreaterThan(0.9); // near-total coverage, sanity check
    expect(totalShare).toBeLessThanOrEqual(1.001);
  });

  it('32822 (Orlando) puts FL-10 first, split across FL-09 and FL-10', () => {
    const entries = lookupZipDistricts('32822');
    expect(entries).not.toBeNull();
    expect(entries!.length).toBeGreaterThanOrEqual(2);
    expect(entries![0].district).toBe(10);
    expect(entries![0].share).toBeCloseTo(0.859, 2);
    const districts = entries!.map((e) => e.district).sort((a, b) => a - b);
    expect(districts).toEqual(expect.arrayContaining([9, 10]));
  });

  it('32502 (Pensacola) resolves to a single district, FL-01', () => {
    const entries = lookupZipDistricts('32502');
    expect(entries).not.toBeNull();
    expect(entries).toHaveLength(1);
    expect(entries![0].district).toBe(1);
    expect(entries![0].share).toBe(1);
  });

  it('every entry clears the population-share OR raw-population floor (the old 2% area noise floor is gone)', () => {
    for (const zip of ['33602', '33301', '33955', '32826', '33849', '33142', '32822']) {
      const entries = lookupZipDistricts(zip);
      expect(entries).not.toBeNull();
      for (const e of entries!) {
        expect(e.share).toBeGreaterThan(0);
        expect(e.share).toBeLessThanOrEqual(1);
        expect(e.share >= 0.005 || e.pop >= 25).toBe(true);
      }
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

  it('every entry declares its share_basis, and it is "area" only when pop is 0', () => {
    for (const zip of ['33602', '33301', '33142', '32502']) {
      const entries = lookupZipDistricts(zip);
      for (const e of entries!) {
        expect(['population', 'area']).toContain(e.share_basis);
        if (e.share_basis === 'area') expect(e.pop).toBe(0);
        else expect(e.pop).toBeGreaterThan(0);
      }
    }
  });

  it('crosswalk covers ~1,013 FL ZIPs total, with real splits now surfaced', () => {
    // Regression guard on the sidecar meta file build_zip_crosswalk.ts
    // writes (supabase/seed/zip-districts-2026.meta.json — kept OUT of
    // zip-districts-2026.json itself so that file's top level stays a pure
    // zip-keyed map for every consumer, not just this module). The 1,013
    // count matches independently across all three source files
    // (EOGPCRP2026 block-equivalency, the Census ZCTA relationship file,
    // and the cartographic ZCTA boundary file) — see the script's build log.
    const meta = JSON.parse(readFileSync(CROSSWALK_META_PATH, 'utf8')) as {
      zip_count: number;
      split_zip_count: number;
    };
    expect(meta.zip_count).toBeGreaterThanOrEqual(1000);
    expect(meta.zip_count).toBeLessThanOrEqual(1030);
    // More real slivers surface now that the 2% area floor is gone and
    // three previously-hidden splits (33955/32826/33849) are counted.
    expect(meta.split_zip_count).toBeGreaterThan(180);
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
