// Tests for the Census geocoder wrapper (T05, SPEC-2026-08-06.md A3).
// Mocks global fetch — no real network calls. Primary concern beyond
// correctness: the input address must NEVER appear in a console.error
// call, since /api/district must never log the street address.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { geocodeAddress } from '@/lib/geo/census-geocode';

const SECRET_ADDRESS = '742 Evergreen Terrace, Springfield, FL 32822';

describe('geo/census-geocode: geocodeAddress', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns lon/lat from a successful match', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          addressMatches: [{ coordinates: { x: -81.32, y: 28.5 } }],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await geocodeAddress(SECRET_ADDRESS);
    expect(result).toEqual({ lon: -81.32, lat: 28.5 });

    // Confirm the request hits the onelineaddress endpoint with the
    // Public_AR_Current benchmark, and never the /geographies endpoint
    // (that one carries the old district field we must ignore).
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/locations/onelineaddress');
    expect(calledUrl).toContain('benchmark=Public_AR_Current');
    expect(calledUrl).not.toContain('/geographies');
  });

  it('returns null when the geocoder finds no match', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { addressMatches: [] } }),
      }),
    );
    const result = await geocodeAddress(SECRET_ADDRESS);
    expect(result).toBeNull();
  });

  it('returns null on a non-OK HTTP response, without logging the address', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    const result = await geocodeAddress(SECRET_ADDRESS);
    expect(result).toBeNull();
    for (const call of errSpy.mock.calls) {
      const joined = call.map(String).join(' ');
      expect(joined).not.toContain(SECRET_ADDRESS);
      expect(joined).not.toContain('Evergreen');
    }
  });

  it('returns null on a network/timeout error, without logging the address', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network unreachable')),
    );
    const result = await geocodeAddress(SECRET_ADDRESS);
    expect(result).toBeNull();
    for (const call of errSpy.mock.calls) {
      const joined = call.map(String).join(' ');
      expect(joined).not.toContain(SECRET_ADDRESS);
      expect(joined).not.toContain('Evergreen');
    }
  });
});
