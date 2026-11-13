import { randomUUID } from 'node:crypto';
import { formatErrorForLog } from '@jini-ai/core';
import { createApiError, type ApiError } from '@jini-ai/protocol';

/** What a host's `onInternalError` sink receives for one failed daemon route: never shown to the caller. */
export interface RouteInternalErrorContext {
  readonly source: string;
  readonly correlationId: string;
  readonly error: unknown;
}

export type RouteInternalErrorSink = (context: RouteInternalErrorContext) => void;

/**
 * The one incident path for an unexpected failure inside a daemon HTTP route: the host sink (or the
 * redacted default log) gets the real error under a fresh request ID; the caller gets `message`
 * (plain words: what failed + what to do) and the same ID, never the raw error.
 * A throwing host sink must not replace the route's answer, so the default log takes over.
 * @complexity O(1) besides the sink and the redaction of one error.
 */
export function reportRouteInternalError(
  required: { readonly source: string; readonly error: unknown; readonly message: string },
  { onInternalError }: { readonly onInternalError?: RouteInternalErrorSink | undefined } = {},
): ApiError {
  const context: RouteInternalErrorContext = { source: required.source, correlationId: randomUUID(), error: required.error };
  try {
    (onInternalError ?? logRouteInternalError)(context);
  } catch {
    // The host sink failed; the default log still records the original incident.
    logRouteInternalError(context);
  }
  return createApiError({ code: 'INTERNAL_ERROR', message: required.message }, { requestId: context.correlationId });
}

function logRouteInternalError(context: RouteInternalErrorContext): void {
  // Default sink of a library route; hosts inject their own through `onInternalError`.
  console.error(`[@jini-ai/daemon] internal error (${context.source}, correlationId=${context.correlationId})`, formatErrorForLog({ error: context.error }));
}
