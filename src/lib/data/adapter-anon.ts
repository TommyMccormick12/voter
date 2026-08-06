// Anon-key Supabase adapter — T14 (Spec C1).
//
// The ONLY place in the app that constructs an anon-key Supabase
// client. Every read that runs under RLS (public candidates, races,
// issues, donors, votes, statements — see migrations 001/002/005/008)
// goes through this client. Do not call `createClient` anywhere else;
// import `getAnonClient` instead.
//
// NOT server-only: reads NEXT_PUBLIC_SUPABASE_URL/ANON_KEY, which are
// safe to ship to the browser (RLS is the real access boundary, not
// key secrecy). Consumed by src/lib/data/* server helpers. The legacy
// client-side src/lib/session.ts (localStorage session path) was
// removed in T21/Spec E1 — the middleware voter_session httpOnly
// cookie is the only session identity now. The service-role adapter
// (adapter-service.ts) stays server-only — that key must never reach
// the client.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

let cached: SupabaseClient<Database> | null = null;

/**
 * Lazily construct (and cache) the anon-key Supabase client.
 * Throws if the required env vars are unset — no silent mock
 * substitution (that was the bug class that hid the empty-DB state
 * for weeks during the FL ingest; see src/lib/data/races.ts).
 */
export function getAnonClient(): SupabaseClient<Database> {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set. Add them to .env.local (see .env.example).'
    );
  }

  cached = createClient<Database>(url, key, {
    auth: { persistSession: false },
  });
  return cached;
}
