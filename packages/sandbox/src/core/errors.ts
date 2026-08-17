/**
 * @file The one error type every `SandboxSession`/`SandboxProviderPort` method rejects with.
 *
 * Purpose:
 * Separated from `ports.ts` on purpose — everything in `ports.ts` is an `interface`/`type` that
 * erases at compile time, and a category a caller can branch on has to exist somewhere at
 * runtime, not just in a type annotation. Keeping the one real class in its own file lets
 * `ports.ts` keep its zero-runtime-statement property (and the literal truth of its own header
 * comment) rather than being "mostly types, plus one class" and quietly stopping being either.
 *
 * Architectural role:
 * Still `./core` — re-exported alongside everything in `ports.ts` from `index.ts`, so nothing
 * changes for a consumer importing `@jini-ai/sandbox/core`. `pnpm guard`'s R12 check scopes to
 * `src/core` as a whole (see `jini.neutralEntries` in `package.json`), not to `ports.ts`
 * specifically, so this file inherits the same "no adapter import, ever" enforcement.
 */

/**
 * Backend-neutral reasons a sandbox operation can fail. A caller handles one of these six
 * categories, never a backend name — "network down" (E2B) and "node isn't installed" (local) are
 * different causes for the same category, `'unavailable'`, and neither should force a caller to
 * branch on which adapter it's talking to.
 */
export type SandboxErrorCategory =
  /** The backend itself could not be reached or started: network failure, quota exceeded, a
   *  required local runtime/binary missing. */
  | 'unavailable'
  /** The operation was refused for lack of rights: an invalid/rejected API key or access token,
   *  no filesystem write permission. */
  | 'permission-denied'
  /** The requested port was already bound. */
  | 'port-in-use'
  /** The requested resource doesn't exist — a file path, a session that's already torn down. */
  | 'not-found'
  /** The operation didn't complete within its bound. */
  | 'timeout'
  /** Any other backend-specific failure. `cause` carries the detail. */
  | 'unknown';

/**
 * The one error type every `SandboxSession`/`SandboxProviderPort` method rejects with. Named
 * `SandboxOperationError` rather than `SandboxError` because `@e2b/code-interpreter`'s own base
 * SDK (`e2b`) already exports a class literally called `SandboxError` — importing both into the
 * same adapter file under the obvious names would collide.
 *
 * `cause` (the standard `Error` field, via `ErrorOptions`) is the escape hatch for the backend's
 * own detail — the original E2B SDK error, the Node `ENOENT`, whatever a specific adapter caught.
 * `category` is what a caller is expected to actually branch on; `cause` is for logging and
 * debugging, not for a caller to inspect to figure out what really happened per backend.
 */
export class SandboxOperationError extends Error {
  readonly category: SandboxErrorCategory;

  constructor(category: SandboxErrorCategory, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SandboxOperationError';
    this.category = category;
  }
}
