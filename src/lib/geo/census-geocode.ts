// Free, keyless Census geocoder — address to lat/lon ONLY.
//
// Per DATA-SOURCES-2026-08-06.md section 2 and SPEC-2026-08-06.md A3: we
// call ONLY the /locations/onelineaddress endpoint with the
// Public_AR_Current benchmark, and never request the /geographies
// endpoint's Congressional District layer. That layer still serves the
// pre-2026 map (see the old, superseded src/lib/api-clients/census.ts,
// which this module intentionally does not reuse). District resolution
// happens locally, via point-in-polygon against the committed 2026
// shapefile in src/lib/geo/districts.ts.
//
// PRIVACY (Decision 4 / SPEC A3 accept criterion): the input address is
// NEVER logged, persisted, or echoed back in any response. Only the
// resulting coordinates leave this function — and callers of this module
// must not persist those either; they exist only to feed the in-memory
// point-in-polygon check for the current request.

// Not marked `server-only` -- see the comment in ./crosswalk.ts. This
// module only calls fetch(), so nothing here technically requires a
// server runtime, but callers should still only reach it from route
// handlers / server code, matching the rest of src/lib/geo/.

const GEOCODE_TIMEOUT_MS = 8000;

export interface GeocodeResult {
  lat: number;
  lon: number;
}

export async function geocodeAddress(
  address: string,
): Promise<GeocodeResult | null> {
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(
    address,
  )}&benchmark=Public_AR_Current&format=json`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      // Safe to log: HTTP status only, no address content.
      console.error(`[geo/census-geocode] geocoder HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as {
      result?: {
        addressMatches?: Array<{
          coordinates?: { x: number; y: number };
        }>;
      };
    };
    const coords = body.result?.addressMatches?.[0]?.coordinates;
    if (
      !coords ||
      typeof coords.x !== 'number' ||
      typeof coords.y !== 'number'
    ) {
      return null;
    }
    return { lon: coords.x, lat: coords.y };
  } catch (err) {
    // Log the failure type only. Never interpolate `address` or `url`
    // here — both may contain the street address.
    console.error(
      '[geo/census-geocode] geocode request failed:',
      err instanceof Error ? err.message : 'unknown error',
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
