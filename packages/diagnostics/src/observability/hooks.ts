import type { Clock } from "@jini-ai/core/primitives";
import type { RequestIdGenerator, RequestLogPort, RequestMetricsPort, ObservabilityPort } from './ports.js';
import { createNoopObservabilityPort } from './noop.js';
export interface RequestHookOptions {
 logger?: RequestLogPort; metrics?: RequestMetricsPort; tracing?: ObservabilityPort;
}
/** Adds request correlation and completed-request hooks using explicit ID and clock ports.
 * @param required Clock and request ID generator, scoped by the host.
 * @param options Optional logging, metrics and tracing adapters.
 * @returns Request tracking with exactly one completion event per request; DB, outbound and
 *   agent-run signals go straight to the tracing adapter (the no-op without one).
 * @throws Hook errors propagate to the caller; adapters choose their own error policy.
 */
export function createHookObservabilityPort(
 { clock, requestIdGenerator }: { clock: Clock; requestIdGenerator: RequestIdGenerator },
 { logger, metrics, tracing }: RequestHookOptions = {},
): ObservabilityPort {
 const signals = tracing ?? createNoopObservabilityPort({});
 return {
  trackRequest(input, options = {}) {
   const requestId = options.requestId ?? requestIdGenerator.generate({});
   const startedAt = clock.nowMs();
   const tracker = tracing?.trackRequest(input, { requestId });
   let ended = false;
   return { requestId, run: <T>(fn: () => T): T => (tracker?.run ? tracker.run(fn) : fn()), end(outcome) {
    if (ended) return; ended = true;
    const event = { requestId, method: input.method, ...outcome, durationMs: Math.max(0, clock.nowMs() - startedAt) };
    tracker?.end(outcome);
    logger?.log(event);
    metrics?.recordRequest(event);
   } };
  },
  trackDbQuery: (input) => signals.trackDbQuery(input),
  trackOutboundCall: (input) => signals.trackOutboundCall(input),
  trackAgentRun: (input, options) => signals.trackAgentRun(input, options),
 };
}
