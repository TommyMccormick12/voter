'use client';

// Split-zip address flow (T06, Spec A3/A5). Some FL zips straddle a
// congressional district line — the crosswalk (src/lib/geo/crosswalk.ts)
// carries more than one district for those, ordered by population share,
// but the resolved answer for a HOUSE race only exists after a street
// address is geocoded and point-in-polygon'd against the 2026 map. This
// form is that address prompt: it explains once why the address is
// needed and that it is never stored, submits to POST /api/district
// (the only place the address itself is read — see that route's header
// comment), and on success hands the resolved district to the page via
// a URL param so the page stays server-rendered and the flow survives a
// refresh (no sessionStorage transport, matching the app's C4 pattern).
//
// States: idle -> submitting -> (navigates away on success) | error
// (with retry — the field stays filled in, nothing is lost). A field-
// level validation error (empty/too-short address) is distinct from a
// server/geocode failure per frontend-standards ("separate validation
// failure from server save failure") and moves focus back to the field;
// a server-side failure surfaces in an alert region instead.
//
// "Show races for all N districts" is an explicit, separately-clicked
// fallback (Spec T06 accept: "never silently") — it is never the
// default outcome of a failed or skipped address lookup.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, TextInput } from '@/components/ui';

const ADDRESS_FIELD_ID = 'split-zip-address';

interface Props {
  zip: string;
  districtCount: number;
}

interface DistrictApiResponse {
  ok: boolean;
  resolved?: boolean;
  district?: number;
  reason?: 'not_florida' | 'address_outside_map';
  error?: 'geocode_failed' | 'invalid_payload' | 'invalid_json' | 'rate_limited';
}

type SubmitState = 'idle' | 'submitting' | 'error';

const GENERIC_ERROR = "Something went wrong on our end. Try again in a moment.";

export function SplitZipAddressForm({ zip, districtCount }: Props) {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [serverError, setServerError] = useState('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = address.trim();
    if (trimmed.length < 3) {
      setFieldError('Enter your street address, city, and state.');
      document.getElementById(ADDRESS_FIELD_ID)?.focus();
      return;
    }
    setFieldError('');
    setServerError('');
    setSubmitState('submitting');

    try {
      const res = await fetch('/api/district', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zip, address: trimmed }),
      });
      const json = (await res.json().catch(() => null)) as DistrictApiResponse | null;

      if (!res.ok || !json || json.ok === false) {
        setSubmitState('error');
        setServerError(
          json?.error === 'geocode_failed'
            ? "We couldn't match that address to a location. Check it and try again."
            : json?.error === 'rate_limited'
              ? "Too many tries — wait a minute and try again."
              : GENERIC_ERROR
        );
        return;
      }

      if (json.resolved && typeof json.district === 'number') {
        const resolvedDistrict = String(json.district).padStart(2, '0');
        router.push(`/race-picker?zip=${encodeURIComponent(zip)}&district=${resolvedDistrict}`);
        return;
      }

      // ok:true but resolved:false — an honest miss, not a silent one.
      setSubmitState('error');
      setServerError(
        json.reason === 'address_outside_map'
          ? "That address didn't match a Florida district. Double-check it, or show all districts below."
          : GENERIC_ERROR
      );
    } catch {
      setSubmitState('error');
      setServerError(GENERIC_ERROR);
    }
  }

  function handleShowAllDistricts() {
    router.push(`/race-picker?zip=${encodeURIComponent(zip)}&allDistricts=1`);
  }

  return (
    <div className="rounded-card border border-gray-200 bg-white p-6">
      <p className="text-sm text-gray-600 mb-4">
        Zip {zip} crosses a district line, so we need your street address to find your House
        race. We use it only to look up your district — we never store or log the address.
      </p>
      <form onSubmit={handleSubmit} noValidate>
        <TextInput
          id={ADDRESS_FIELD_ID}
          label="Street address"
          placeholder="123 Main St, City, FL"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          error={fieldError}
          disabled={submitState === 'submitting'}
          required
          autoComplete="street-address"
        />
        <div className="mt-4">
          <Button type="submit" loading={submitState === 'submitting'} disabled={submitState === 'submitting'}>
            Find my district
          </Button>
        </div>
      </form>
      {submitState === 'error' && serverError && (
        <p role="alert" className="text-sm text-status-error mt-4">
          {serverError}
        </p>
      )}
      <div className="mt-6 pt-4 border-t border-gray-100">
        <button
          type="button"
          onClick={handleShowAllDistricts}
          className="text-sm text-blue-600 font-medium hover:underline"
        >
          Or show races for all {districtCount} districts in zip {zip}
        </button>
      </div>
    </div>
  );
}
