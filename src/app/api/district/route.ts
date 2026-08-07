// POST /api/district — ZIP (+ address) to 2026 congressional district.
//
// Backs T05 (SPEC-2026-08-06.md A3). Flow:
//   1. Single-district ZIP -> answer straight from the precomputed
//      crosswalk (supabase/seed/zip-districts-2026.json).
//   2. Split ZIP, no address -> { needsAddress: true, districts: [...] }.
//   3. Split ZIP + address -> geocode (Census, free/keyless) -> lat/lon
//      only -> point-in-polygon (turf) against the committed 2026
//      shapefile -> district.
//   4. ZIP absent from the crosswalk -> honest "not Florida" empty state,
//      never an error.
//
// STATELESS THIS WAVE: no DB reads or writes. The address is never
// persisted or logged anywhere in this file or the modules it calls —
// only the resolved district number leaves the request.
//
// Rate-limited the same way the other write-shaped routes are
// (checkRateLimits, session + IP buckets) — this route makes an outbound
// call to the Census geocoder per request, which is exactly the kind of
// cost/abuse surface those other routes protect against.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { COOKIE_NAMES, readCookie } from '@/lib/cookies';
import { clientIpFromHeaders } from '@/lib/geo';
import { checkRateLimits } from '@/lib/rate-limit';
import { lookupZipDistricts } from '@/lib/geo/crosswalk';
import { districtForPoint } from '@/lib/geo/districts';
import { geocodeAddress } from '@/lib/geo/census-geocode';

// Mirrors the shape of the named *_LIMITS constants in src/lib/rate-limit.ts
// (this route doesn't own that file this wave, so the limit is declared
// locally rather than added there). Calibrated like VISIT_LIMITS: a voter
// might retry a couple of ZIPs or re-enter an address once or twice while
// finding their district, not dozens of times.
const DISTRICT_LIMITS = {
  session: { capacity: 30, windowMs: 60 * 60 * 1000 },
  ip: { capacity: 100, windowMs: 60 * 60 * 1000 },
} as const;

const DistrictRequestSchema = z.object({
  zip: z.string().regex(/^\d{5}$/, 'zip must be 5 digits'),
  // Only read when the ZIP is split. Trimmed + length-capped for sanity;
  // never logged or persisted anywhere downstream (see census-geocode.ts).
  address: z.string().trim().min(3).max(300).optional(),
});

export async function POST(request: NextRequest) {
  // Rate limit FIRST — this route calls an external geocoder per request
  // on the address path, so unbounded retries are a real cost/abuse
  // surface, same rationale as /api/match.
  const sessionId = (await readCookie(COOKIE_NAMES.session)) ?? null;
  const ip = clientIpFromHeaders(request.headers);
  const rate = await checkRateLimits({
    sessionId,
    ip,
    sessionLimit: DISTRICT_LIMITS.session,
    ipLimit: DISTRICT_LIMITS.ip,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: 'rate_limited',
        scope: rate.exceeded,
        retry_after_seconds: rate.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(rate.retryAfterSeconds) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_json' },
      { status: 400 },
    );
  }

  const parsed = DistrictRequestSchema.safeParse(body);
  if (!parsed.success) {
    // zod's flatten() carries field names and length/format messages only
    // (min/max counts), never the submitted string value — safe to return
    // even when the failing field is `address`.
    return NextResponse.json(
      { ok: false, error: 'invalid_payload', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { zip, address } = parsed.data;

  const entries = lookupZipDistricts(zip);

  // ZIP not in the crosswalk: either outside Florida, or (rare) no
  // district clears the 2% noise floor. Both are the honest empty state,
  // not an error — the accept criterion for A3 requires non-FL ZIPs to
  // degrade gracefully.
  if (!entries || entries.length === 0) {
    return NextResponse.json({
      ok: true,
      resolved: false,
      reason: 'not_florida',
      districts: [],
    });
  }

  // Single-district ZIP: answer directly, no geocoding needed.
  if (entries.length === 1) {
    return NextResponse.json({
      ok: true,
      resolved: true,
      method: 'zip',
      district: entries[0].district,
      districts: entries,
    });
  }

  // Split ZIP, no address yet: ask for one.
  if (!address) {
    return NextResponse.json({
      ok: true,
      resolved: false,
      needsAddress: true,
      districts: entries,
    });
  }

  // Split ZIP + address: geocode, then point-in-polygon locally. The
  // geocoder's own district field is never read (old map) — see
  // census-geocode.ts header comment.
  const coords = await geocodeAddress(address);
  if (!coords) {
    return NextResponse.json(
      { ok: false, error: 'geocode_failed' },
      { status: 422 },
    );
  }

  const district = districtForPoint(coords.lon, coords.lat);
  if (district === null) {
    // Geocoded successfully but landed outside every FL district polygon
    // (e.g. an out-of-state address, or a coastal edge past the
    // simplified boundary). Honest empty state, not an error.
    return NextResponse.json({
      ok: true,
      resolved: false,
      reason: 'address_outside_map',
      districts: entries,
    });
  }

  return NextResponse.json({
    ok: true,
    resolved: true,
    method: 'address',
    district,
  });
}
