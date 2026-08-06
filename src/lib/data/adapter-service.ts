// Service-role Supabase adapter — T14 (Spec C1).
//
// The ONLY place in the app that constructs a service-role Supabase
// client (RLS-bypass). Used by server-only paths that must read or
// write tables with no public policy: candidate_reports (insert +
// admin review queue), llm_matches, consent_audit, and /admin's
// aggregate reads. Do not call `createClient` anywhere else; import
// `getServiceClient` instead.
//
// The service-role key must never reach the client bundle — every
// caller of this module must be a server component, route handler, or
// server-only lib (enforced here via the `server-only` import guard).

import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

let cached: SupabaseClient<Database> | null = null;

/**
 * Lazily construct (and cache) the service-role Supabase client.
 * Throws if the required env vars are unset.
 */
export function getServiceClient(): SupabaseClient<Database> {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set. Add them to .env.local (see .env.example).'
    );
  }

  cached = createClient<Database>(url, key, {
    auth: { persistSession: false },
  });
  return cached;
}
