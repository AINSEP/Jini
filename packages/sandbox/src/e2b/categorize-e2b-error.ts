/**
 * @file Maps whatever the E2B SDK throws onto core's backend-neutral `SandboxErrorCategory`.
 *
 * Purpose:
 * Every `E2bSandboxHandle` call this adapter makes can fail, and every `SandboxSession` method
 * must reject with a `SandboxOperationError` carrying one of core's six categories — not a raw
 * SDK error, which would leak `/e2b`-specific detail through a port meant to hide it.
 *
 * The mapping is by error `.name`, checked against the real `e2b` package's exported error class
 * names (`AuthenticationError`, `FileNotFoundError`, …) — as strings, not as imported classes.
 * Importing those classes here would give `categorizeE2bError` (and therefore
 * `wrap-e2b-sandbox.ts`, which has been import-free of the real SDK by design since Slice 1) a
 * hard dependency on `@e2b/code-interpreter`. Matching by name keeps that boundary: only
 * `provider.ts` needs the real SDK installed to run; this file needs it only to have once read
 * its `.d.ts`, which is a very different kind of dependency and doesn't show up in `import`.
 */
import type { SandboxErrorCategory } from '../core/errors.js';

/** Real `e2b` SDK error class names this adapter knows how to categorize, keyed to which
 *  `SandboxErrorCategory` they mean. Anything not in this map — including a caught value that
 *  isn't an `Error` at all — falls through to `'unknown'`. */
const KNOWN_ERROR_NAMES: Readonly<Record<string, SandboxErrorCategory>> = {
  AuthenticationError: 'permission-denied',
  FileNotFoundError: 'not-found',
  NotFoundError: 'not-found',
  SandboxNotFoundError: 'not-found',
  TimeoutError: 'timeout',
  RateLimitError: 'unavailable',
  NotEnoughSpaceError: 'unavailable',
};

/** The `.name` of whatever was thrown, or `undefined` for a non-`Error` throw (E2B's SDK
 *  shouldn't throw a bare string/object, but a caller of this function must not assume). */
function nameOf(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

export function categorizeE2bError(error: unknown): SandboxErrorCategory {
  const name = nameOf(error);
  if (name === undefined) return 'unknown';
  return KNOWN_ERROR_NAMES[name] ?? 'unknown';
}
