/**
 * @file The error contract every admin route group throws, host-supplied or Jini-shipped.
 *
 * Ported from the reference implementation's `lib/api.ts` (`ApiError`, `describeApiError`), which is the
 * only implementation of this shape that has been through real operator use. Two decisions from
 * that file are carried across deliberately, because both were arrived at by an audit and both
 * look like oversights if you only read the code:
 *
 * 1. **`body` is kept raw.** A caller sometimes needs a route-specific field beyond
 *    `code`/`message` (a 409's `currentVersion`, a validation route's field list). Exposing the
 *    parsed body means that never requires an `AdminApiError` subclass per route.
 *
 * 2. **There is deliberately NO shared `code` -> message table.** The same `code` means
 *    genuinely different things in different domains — in the reference implementation,
 *    `RESOURCE_CONFLICT` is "still
 *    referenced elsewhere" on Roles, "that slug is already taken" on Workspace, and "that
 *    username is already in use" on Users. Three correct operator-facing sentences for one code.
 *    A shared table could only pick one, which is a regression dressed as consolidation. So
 *    `describeApiError` is only the *base case*: it decides what to show when the server sent no
 *    message, or when the thrown value is not an `AdminApiError` at all (network failure, a
 *    thrown non-Error). Panels layer their own per-code copy on top and fall through to this.
 */

/** A failed admin API call that reached the server and came back non-2xx. */
export class AdminApiError extends Error {
  readonly status: number;

  /**
   * Canonical error `code` from the response body when the server sent one. Not enumerated here
   * on purpose — the vocabulary belongs to the host's API, and a union type in this package would
   * have to be widened by a Jini release every time a product added a code.
   */
  readonly code?: string | undefined;

  /** Raw parsed JSON error body, when present. See decision 1 in the file header. */
  readonly body?: Record<string, unknown> | undefined;

  constructor(message: string, status: number, code?: string, body?: Record<string, unknown>) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/**
 * Base-case translation from a thrown request error to operator-facing copy.
 *
 * This is the "opt-out by default" fallback, not a complete message catalog — see decision 2 in
 * the file header. A panel with real per-code handling checks its own codes first and falls
 * through here for the rest:
 *
 * ```ts
 * function describe(e: unknown, fallback: string): string {
 *   if (e instanceof AdminApiError && e.code === 'PANEL_SPECIFIC_CODE') return '...';
 *   return describeApiError(e, fallback);
 * }
 * ```
 *
 * @complexity O(1) — two `instanceof` checks, no iteration.
 */
export function describeApiError(e: unknown, fallback: string): string {
  if (e instanceof AdminApiError) return e.message || fallback;
  return e instanceof Error ? e.message : fallback;
}
