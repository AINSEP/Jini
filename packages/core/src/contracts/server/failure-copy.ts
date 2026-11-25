/**
 * @file The caller-facing words for a request the server could not finish, chosen by HTTP method.
 * A read (GET/HEAD/OPTIONS) changed nothing, so telling its caller to "check whether your change was
 * saved" sends them hunting for a write that never happened (live-found on a failed page load,
 * 2026-11-25); a read says nothing was changed. A write still asks the caller to check, because a
 * failure after the write committed is indistinguishable from one before it.
 */

const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);
const MESSAGE = 'The server could not finish this request.';
const READ_FALLBACK = { message: MESSAGE, action: 'Nothing was changed. Try again; if it keeps failing, report the error ID.' } as const;
const WRITE_FALLBACK = { message: MESSAGE, action: 'Check whether your change was saved, then try again. If it keeps failing, report the error ID.' } as const;

/** Whether `method` only reads, case-insensitively. @complexity O(1). */
function isReadMethod({ method }: { readonly method: string }): boolean {
  return READ_METHODS.has(method.toUpperCase());
}

/** The `{message, action}` fallback a route's operation reports for an unanticipated failure. @complexity O(1). */
export function httpFallbackCopy({ method }: { readonly method: string }, _optional: Record<string, never> = {}): { readonly message: string; readonly action: string } {
  return isReadMethod({ method }) ? READ_FALLBACK : WRITE_FALLBACK;
}

/** The one-line INTERNAL_ERROR message sent when no reporter describes the failure. @complexity O(1). */
export function internalErrorMessage({ method }: { readonly method: string }, _optional: Record<string, never> = {}): string {
  return isReadMethod({ method })
    ? `${MESSAGE} Nothing was changed. Try again; if it keeps failing, copy the request ID and report this problem.`
    : `${MESSAGE} Check whether your change was saved, then copy the request ID and report this problem.`;
}
