import type { Clock } from "@jini-ai/core/primitives";
import type { RequestIdGenerator, RequestLogPort, RequestMetricsPort, ObservabilityPort } from './ports.js';
export interface RequestHookOptions {
 logger?: RequestLogPort; metrics?: RequestMetricsPort; tracing?: ObservabilityPort;
}
/** Adds request correlation and completed-request hooks using explicit ID and clock ports.
 * @param required Clock and request ID generator, scoped by the host.
 * @param options Optional logging, metrics and tracing adapters.
 * @returns Request tracking with exactly one completion event per request.
 * @throws Hook errors propagate to the caller; adapters choose their own error policy.
 */
export function createHookObservabilityPort(
 { clock, requestIdGenerator }: { clock: Clock; requestIdGenerator: RequestIdGenerator },
 { logger, metrics, tracing }: RequestHookOptions = {},
): ObservabilityPort {
 return { trackRequest(input, options = {}) {
  const requestId = options.requestId ?? requestIdGenerator.generate({});
  const startedAt = clock.nowMs();
  const tracker = tracing?.trackRequest(input, { requestId });
  let ended = false;
  return { requestId, end(outcome) {
   if (ended) return; ended = true;
   const event = { requestId, method: input.method, ...outcome, durationMs: Math.max(0, clock.nowMs() - startedAt) };
   tracker?.end(outcome);
   logger?.log(event);
   metrics?.recordRequest(event);
  } };
 } };
}
