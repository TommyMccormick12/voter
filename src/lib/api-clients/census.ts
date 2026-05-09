// US Census Geocoding API + Census Reporter — ZIP → Congressional District.
//
// Two endpoints used:
//   1. Geocoding API: address-to-coordinates lookup
//   2. TIGER/Line state legislative district lookup via lat/lon
//
// No API key required. Free.
//
// Docs: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html

import { fetchCached } from './base';

export interface DistrictResult {
  state: string;     // 'NJ'
  district: string;  // '07' (zero-padded congressional district)
  state_fips: string;
}

/**
 * Look up Congressional District by ZIP code via the US Census Geocoding API.
 * The Census API doesn't expose ZIP→CD directly, so this:
 *   1. Geocodes the ZIP centroid → lat/lon
 *   2. Reverse-geocodes the lat/lon → CD
 *
 * For Phase 2C: pre-computed via the HUD ZIP-to-CD crosswalk file is faster,
 * but this works without bundling a multi-MB crosswalk.
 */
export async function zipToDistrict(zip: string): Promise<DistrictResult | null> {
  // Step 1: geocode ZIP centroid by treating it as a 1-line address
  const url1 = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(
    zip
  )}&benchmark=Public_AR_Current&format=json`;
  const geocode = await fetchCached<{
    result?: { addressMatches?: Array<{ coordinates?: { x: number; y: number } }> };
  }>(url1, { cacheTag: `zip-geocode:${zip}` });

  const coords = geocode.result?.addressMatches?.[0]?.coordinates;
  if (!coords) return null;

  // Step 2: reverse geocode to find the Congressional District
  // Layer 54 = "118th Congressional Districts" (current).
  // For 119th Congress (2025+), use vintage Census2020_Current.
  const url2 = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${coords.x}&y=${coords.y}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Congressional+Districts&format=json`;
  const district = await fetchCached<{
    result?: {
      geographies?: {
        'Congressional Districts'?: Array<Record<string, string>>;
      };
    };
  }>(url2, { cacheTag: `zip-cd:${zip}` });

  const cd = district.result?.geographies?.['Congressional Districts']?.[0];
  if (!cd) return null;

  return {
    state: stateFipsToAbbr(cd.STATE ?? '') ?? '',
    district: String(cd.CD119 ?? cd.CD118 ?? cd.BASENAME ?? '').padStart(2, '0'),
    state_fips: cd.STATE ?? '',
  };
}

const FIPS_TO_STATE: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO',
  '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI',
  '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
  '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY',
};

function stateFipsToAbbr(fips: string): string | null {
  return FIPS_TO_STATE[fips] ?? null;
}
