/** Express-side same-origin check for raw routes; the guard itself lives in core. */
import type { RequestWithOriginHeaders } from '@jini-ai/core';
import { guardSameOrigin, statusForError, type OriginContext } from '@jini-ai/core/contracts/server';
import { sendApiError, type ApiErrorResponseWriter } from './response.js';

/**
 * The same-origin check for a raw route (one not mounted through `mountJsonRoute`, e.g. an SSE
 * stream): answers a cross-origin request with the guard's own error and status and returns
 * `false`, so the caller only has to `return`. `mountJsonRoute` routes get this from `requireSameOrigin`.
 * Framework-neutral: `req` needs only the origin headers, `res` only `status().json()`.
 * @complexity O(1) plus the origin check.
 */
export function passesSameOriginGuard({ req, res, origin }: { readonly req: RequestWithOriginHeaders; readonly res: ApiErrorResponseWriter; readonly origin: OriginContext }, _optional: Record<string, never> = {}): boolean {
  const verdict = guardSameOrigin({ req, origin });
  if (verdict.ok) return true;
  sendApiError({ res, status: statusForError({ error: verdict.error }), error: verdict.error });
  return false;
}
