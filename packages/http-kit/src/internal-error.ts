import { randomUUID } from 'node:crypto';
import { formatErrorForLog } from '@jini-ai/core';
import { createApiError, type ApiError } from '@jini-ai/protocol';

/** What every host `onInternalError` sink receives besides the route's own fields: never shown to the caller. */
export interface RouteInternalErrorContext {
  readonly correlationId: string;
  readonly error: unknown;
}

/** A host sink for one route's incidents. Hosts apply their own redaction policy here. */
export type RouteInternalErrorSink<C extends RouteInternalErrorContext = RouteInternalErrorContext & { readonly source: string }> = (context: C) => void;

/**
 * The one incident path for an unexpected failure inside a Jini HTTP route (SEC-005): the host
 * sink (or the redacted default log) gets the real error under a fresh request ID; the caller gets
 * `message` (plain words: what failed + what to do) and the same ID, never the raw error.
 * Every route pack's `onInternalError` seam goes through here, so the sink-failure and default-log
 * behaviour is the same everywhere.
 * @param required.report The route's own context fields (`source`, `runId`, `batchId`, ...) and `error`.
 * @param required.logSource Label of the default log line, e.g. `run-start` or `connectors/auth.list`.
 * @param required.message Caller-facing plain words. Never the raw error or a generic "internal error".
 * @param optional.onInternalError Host sink. A throwing sink never replaces the answer.
 * @returns The `INTERNAL_ERROR` ApiError carrying `requestId`.
 * @complexity O(1) besides the sink and the redaction of one error.
 */
export function reportRouteInternalError<E extends { readonly error: unknown }>(
  required: { readonly report: E; readonly logSource: string; readonly message: string },
  { onInternalError }: { readonly onInternalError?: ((context: E & { readonly correlationId: string }) => void) | undefined } = {},
): ApiError {
  const context: E & { readonly correlationId: string } = { ...required.report, correlationId: randomUUID() };
  deliverRouteInternalError({ context, logSource: required.logSource }, { onInternalError });
  return createApiError({ code: 'INTERNAL_ERROR', message: required.message }, { requestId: context.correlationId });
}

function deliverRouteInternalError<C extends RouteInternalErrorContext>(
  { context, logSource }: { readonly context: C; readonly logSource: string },
  { onInternalError }: { readonly onInternalError?: ((context: C) => void) | undefined },
): void {
  if (onInternalError === undefined) { logRouteInternalError({ context, logSource }); return; }
  try {
    onInternalError(context);
  } catch (sinkError) {
    // The host sink failed: the default log still records the original incident, then the
    // sink's own failure, so neither is lost and the route still answers.
    logRouteInternalError({ context, logSource });
    // eslint-disable-next-line no-console
    console.error(`[@jini-ai/http-kit] internal error sink failed (${logSource}, correlationId=${context.correlationId})`, formatErrorForLog({ error: sinkError }));
  }
}

function logRouteInternalError({ context, logSource }: { readonly context: RouteInternalErrorContext; readonly logSource: string }): void {
  // Default sink of a library route; hosts inject their own through `onInternalError`.
  // eslint-disable-next-line no-console
  console.error(`[@jini-ai/http-kit] internal error (${logSource}, correlationId=${context.correlationId})`, formatErrorForLog({ error: context.error }));
}
