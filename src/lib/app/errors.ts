// Shared error mapping for application modules under src/lib/app/**.
//
// Backend-standards rule: "Return stable public error codes ... Never
// catch an error and return fake success data." Every write path in
// this app maps a Postgres/PostgREST error to one of a small set of
// stable codes + a real HTTP status, instead of letting route handlers
// invent ad-hoc strings per call site.

import 'server-only';

export interface AppErrorLike {
  code?: string;
  message: string;
}

export interface MappedError {
  code: 'invalid_reference' | 'write_failed';
  status: number;
  detail: string;
}

/**
 * Map a Postgres/PostgREST error to a stable public code + HTTP status.
 *
 * Postgres SQLSTATE class 23 = integrity constraint violation (foreign
 * key, not-null, check, unique). Those are caused by a bad client
 * payload (e.g. a candidate_id/race_id/issue_id that doesn't exist),
 * so they map to 400. Anything else is an unexpected backend failure
 * and maps to 500 — never swallowed into a fake 200.
 */
export function mapWriteError(error: AppErrorLike): MappedError {
  if (error.code && error.code.startsWith('23')) {
    return { code: 'invalid_reference', status: 400, detail: error.message };
  }
  return { code: 'write_failed', status: 500, detail: error.message };
}
