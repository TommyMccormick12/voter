// Component test for the split-zip address flow (T06, Spec A3/A5).
// SplitZipAddressForm is the UI shown when a zip genuinely straddles a
// congressional district line — it must explain why an address is
// needed and that it is never stored, submit to POST /api/district,
// and route to a resolved-district URL on success. Failures (geocode
// miss, address outside the map, network error) must show an honest
// error with retry, never a silent fallback. The "show all N
// districts" fallback must require an explicit click.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SplitZipAddressForm } from '@/app/race-picker/SplitZipAddressForm';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn() }),
}));

describe('SplitZipAddressForm', () => {
  beforeEach(() => {
    pushMock.mockClear();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('explains why the address is needed and that it is not stored', () => {
    render(<SplitZipAddressForm zip="33142" districtCount={2} />);
    expect(
      screen.getByText(/we never store or log the address/i)
    ).toBeInTheDocument();
  });

  it('shows the explicit "show all N districts" fallback, never auto-selected', () => {
    render(<SplitZipAddressForm zip="33142" districtCount={2} />);
    expect(
      screen.getByRole('button', { name: /show races for all 2 districts in zip 33142/i })
    ).toBeInTheDocument();
    // Fetch must not have been called just by rendering — nothing happens
    // until the user acts.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an empty/too-short address without calling the API, and reports the field error', async () => {
    render(<SplitZipAddressForm zip="33142" districtCount={2} />);
    fireEvent.click(screen.getByRole('button', { name: /find my district/i }));
    expect(await screen.findByText(/enter your street address/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resolves an address and navigates to the district-scoped URL', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, resolved: true, method: 'address', district: 24 }),
    } as Response);

    render(<SplitZipAddressForm zip="33142" districtCount={2} />);
    fireEvent.change(screen.getByLabelText(/street address/i), {
      target: { value: '123 NW 17th Ave, Miami, FL' },
    });
    fireEvent.click(screen.getByRole('button', { name: /find my district/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/race-picker?zip=33142&district=24'));
    expect(fetch).toHaveBeenCalledWith(
      '/api/district',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ zip: '33142', address: '123 NW 17th Ave, Miami, FL' }),
      })
    );
  });

  it('shows an honest, retryable error on geocode_failed — never a silent fallback', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false, error: 'geocode_failed' }),
    } as Response);

    render(<SplitZipAddressForm zip="33142" districtCount={2} />);
    fireEvent.change(screen.getByLabelText(/street address/i), {
      target: { value: 'not a real address at all' },
    });
    fireEvent.click(screen.getByRole('button', { name: /find my district/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't match that address/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows an honest error when the address geocodes outside every FL district', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, resolved: false, reason: 'address_outside_map', districts: [] }),
    } as Response);

    render(<SplitZipAddressForm zip="33142" districtCount={2} />);
    fireEvent.change(screen.getByLabelText(/street address/i), {
      target: { value: '1 Somewhere Else Rd, Atlanta, GA' },
    });
    fireEvent.click(screen.getByRole('button', { name: /find my district/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/didn't match a florida district/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('surfaces a network failure as an honest error, not a crash or a silent fallback', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network down'));

    render(<SplitZipAddressForm zip="33142" districtCount={2} />);
    fireEvent.change(screen.getByLabelText(/street address/i), {
      target: { value: '123 NW 17th Ave, Miami, FL' },
    });
    fireEvent.click(screen.getByRole('button', { name: /find my district/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('navigates to the allDistricts fallback URL on explicit click', () => {
    render(<SplitZipAddressForm zip="33142" districtCount={2} />);
    fireEvent.click(
      screen.getByRole('button', { name: /show races for all 2 districts in zip 33142/i })
    );
    expect(pushMock).toHaveBeenCalledWith('/race-picker?zip=33142&allDistricts=1');
    expect(fetch).not.toHaveBeenCalled();
  });
});
