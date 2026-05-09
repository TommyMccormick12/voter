// Server-side Supabase client using the SERVICE_ROLE key (bypasses RLS).
// Used only by seed scripts — never imported by app code.
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';
import { requireEnv } from '../../src/lib/api-clients/base';

export function getAdminClient() {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
