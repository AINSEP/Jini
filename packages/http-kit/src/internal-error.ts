import { randomUUID } from 'node:crypto';
import { describeErrorForLog } from '@jini-ai/core';
import { createApiError, type ApiError } from '@jini-ai/protocol';

/** What every host `onInternalError` sink receives besides the route's own fields: never shown to the caller.
 *  This is the host channel: the full error, the request ID the caller copies and the operation
 *  label, so the host can store one full record (under its own redaction) that the ID finds. */
export interface RouteInternalErrorContext {
  readonly correlationId: string;
  readonly error: unknown;
  /** The operation label the default line prints (`run-start`, `connectors/auth.list`). Optional so
   *  hosts and route packs that build a context themselves stay assignable. */
  readonly logSource?: string;
}

/** A host sink for one route's incidents. Hosts apply their own redaction policy here. */
export type RouteInternalErrorSink<C extends RouteInternalErrorContext = RouteInternalErrorContext & { readonly source: string }> = (context: C) => void;

/**
 * The one incident path for an unexpected failure inside a Jini HTTP route (SEC-005): the host
 * sink gets the real error, the route's own fields (`runId`, ...) and the operation label under a
 * fresh request ID (or the default log gets its class/code only); the caller gets
 * `message` (plain words: what failed + what to do) and the same ID, never the raw error.
 * Every route pack's `onInternalError` seam goes through here, so the sink-failure and default-log
 * behaviour is the same everywhere.
 * @param required.report The route's own context fields (`source`, `runId`, `batchId`, ...) and `error`.
 * @param required.logSource Label of the default log line, e.g. `run-start` or `connectors/auth.list`.
 * @param required.message Caller-facing plain words. Never the raw error or a generic "internal error".
 * @param optional.onInternalError Host sink. A throwing sink never replaces the answer.
 * @returns The `INTERNAL_ERROR` ApiError carrying `requestId`.
 * @complexity O(1) besides the sink.
 */
export function reportRouteInternalError<E extends { readonly error: unknown }>(
  required: { readonly report: E; readonly logSource: string; readonly message: string },
  { onInternalError }: { readonly onInternalError?: ((context: E & { readonly correlationId: string; readonly logSource: string }) => void) | undefined } = {},
): ApiError {
  // `logSource` has its own key, so a route field named `operation` or `source` is never overwritten.
  const context: E & { readonly correlationId: string; readonly logSource: string } = { ...required.report, correlationId: randomUUID(), logSource: required.logSource };
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
    console.error(`[@jini-ai/http-kit] Could not report route failure (${logSource}, correlationId=${context.correlationId})`, describeErrorForLog({ err: sinkError }));
  }
}

function logRouteInternalError({ context, logSource }: { readonly context: RouteInternalErrorContext; readonly logSource: string }): void {
  // Default sink of a library route; hosts inject their own through `onInternalError`.
  // Safe metadata only (class + constant code + request ID): a route's error can quote request
  // input or a credential that no default redaction pattern recognises. The host sink gets the
  // original error and decides what its own log may keep.
  // eslint-disable-next-line no-console
  console.error(`[@jini-ai/http-kit] Route handler failed (${logSource}, correlationId=${context.correlationId})`, describeErrorForLog({ err: context.error }));
}
