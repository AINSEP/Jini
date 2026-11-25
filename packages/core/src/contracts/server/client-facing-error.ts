/**
 * @file The one carrier a route uses to disclose an error it has already classified as safe for the
 * caller. A leaf module with no runtime imports, so both the error reporter and the JSON route
 * binding can depend on it without importing each other.
 */
import type { ServerApiError } from './api-error.js';

/**
 * Thrown by a route's `handle` — or by anything it calls, at any depth — to bypass the SEC-005
 * redaction below with an error the throwing code has already decided is safe for the caller
 * to see. Prefer returning `err(...)` from `handle` when the failure is anticipated at that point;
 * this class is for the same kind of failure discovered a level deeper, inside an awaited call
 * `handle` did not wrap in its own `try`.
 *
 * Not a way to defeat SEC-005: the only way to reach the branch that reads this class is for code to
 * construct one itself, naming the exact error — code and message — it is choosing to disclose.
 * Any thrown value that is not this class (including a plain `Error` with an actionable-looking
 * message) still redacts; nothing here widens what a route can leak by accident.
 */
export class ClientFacingError extends Error {
  readonly apiError: ServerApiError;

  constructor({ apiError }: { readonly apiError: ServerApiError }, _optional: Record<string, never> = {}) {
    super(apiError.message);
    this.name = 'ClientFacingError';
    this.apiError = apiError;
  }
}
