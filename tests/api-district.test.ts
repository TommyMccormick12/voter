// Contract tests for POST /api/district (T05, SPEC-2026-08-06.md A3).
// Mocks every collaborator (cookies, rate limit, crosswalk, districts,
// geocoder) so this exercises only the route's own branching: single-ZIP,
// split-ZIP-needs-address, split-ZIP-with-address, non-FL ZIP, invalid
// input, and rate-limit rejection.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  exceeded?: 'session' | 'ip';
}

// vi.mock factories are hoisted above imports; vi.hoisted() declares these
// mocks in that same hoisted scope so the factories below can reference
// them without a TDZ error.
const {
  readCookieMock,
  checkRateLimitsMock,
  lookupZipDistrictsMock,
  districtForPointMock,
  geocodeAddressMock,
} = vi.hoisted(() => ({
  readCookieMock: vi.fn(async (): Promise<string> => 'sess-test'),
  checkRateLimitsMock: vi.fn(
    async (): Promise<RateLimitResult> => ({
      allowed: true,
      remaining: 10,
      retryAfterSeconds: 0,
    }),
  ),
  lookupZipDistrictsMock: vi.fn(),
  districtForPointMock: vi.fn(),
  geocodeAddressMock: vi.fn(),
}));

vi.mock('@/lib/cookies', () => ({
  COOKIE_NAMES: { session: 'voter_session' },
  readCookie: readCookieMock,
}));
vi.mock('@/lib/geo', () => ({
  clientIpFromHeaders: () => '1.2.3.4',
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimits: checkRateLimitsMock,
}));
vi.mock('@/lib/geo/crosswalk', () => ({
  lookupZipDistricts: lookupZipDistrictsMock,
}));
vi.mock('@/lib/geo/districts', () => ({
  districtForPoint: districtForPointMock,
}));
vi.mock('@/lib/geo/census-geocode', () => ({
  geocodeAddress: geocodeAddressMock,
}));

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/district', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/district', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readCookieMock.mockResolvedValue('sess-test');
    checkRateLimitsMock.mockResolvedValue({
      allowed: true,
      remaining: 10,
      retryAfterSeconds: 0,
    });
  });

  it('rejects a malformed zip', async () => {
    const { POST } = await import('@/app/api/district/route');
    const res = await POST(postRequest({ zip: 'abc' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe('invalid_payload');
  });

  it('returns the honest empty state for a ZIP outside the crosswalk', async () => {
    lookupZipDistrictsMock.mockReturnValue(null);
    const { POST } = await import('@/app/api/district/route');
    const res = await POST(postRequest({ zip: '90210' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      resolved: false,
      reason: 'not_florida',
      districts: [],
    });
  });

  it('answers directly for a single-district ZIP', async () => {
    lookupZipDistrictsMock.mockReturnValue([{ district: 1, share: 1 }]);
    const { POST } = await import('@/app/api/district/route');
    const res = await POST(postRequest({ zip: '32502' }));
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      resolved: true,
      method: 'zip',
      district: 1,
      districts: [{ district: 1, share: 1 }],
    });
    expect(geocodeAddressMock).not.toHaveBeenCalled();
  });

  it('asks for an address on a split ZIP with none provided', async () => {
    lookupZipDistrictsMock.mockReturnValue([
      { district: 24, share: 0.46 },
      { district: 26, share: 0.54 },
    ]);
    const { POST } = await import('@/app/api/district/route');
    const res = await POST(postRequest({ zip: '33142' }));
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.resolved).toBe(false);
    expect(json.needsAddress).toBe(true);
    expect(json.districts).toHaveLength(2);
    expect(geocodeAddressMock).not.toHaveBeenCalled();
  });

  it('resolves a split ZIP with an address via geocode + point-in-polygon', async () => {
    lookupZipDistrictsMock.mockReturnValue([
      { district: 24, share: 0.46 },
      { district: 26, share: 0.54 },
    ]);
    geocodeAddressMock.mockResolvedValue({ lon: -80.25, lat: 25.79 });
    districtForPointMock.mockReturnValue(24);
    const { POST } = await import('@/app/api/district/route');
    const res = await POST(
      postRequest({ zip: '33142', address: '123 NW 17th Ave, Miami, FL' }),
    );
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      resolved: true,
      method: 'address',
      district: 24,
    });
    // The route must pass only numeric coordinates downstream, never the
    // address string, to the point-in-polygon lookup.
    expect(districtForPointMock).toHaveBeenCalledWith(-80.25, 25.79);
  });

  it('returns geocode_failed when the address does not match', async () => {
    lookupZipDistrictsMock.mockReturnValue([
      { district: 24, share: 0.46 },
      { district: 26, share: 0.54 },
    ]);
    geocodeAddressMock.mockResolvedValue(null);
    const { POST } = await import('@/app/api/district/route');
    const res = await POST(
      postRequest({ zip: '33142', address: 'not a real address at all' }),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json).toEqual({ ok: false, error: 'geocode_failed' });
  });

  it('returns 429 when rate-limited, without calling the geocoder', async () => {
    checkRateLimitsMock.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 42,
      exceeded: 'session',
    });
    const { POST } = await import('@/app/api/district/route');
    const res = await POST(postRequest({ zip: '33142', address: 'x'.repeat(10) }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(geocodeAddressMock).not.toHaveBeenCalled();
    expect(lookupZipDistrictsMock).not.toHaveBeenCalled();
  });
});
