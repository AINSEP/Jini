import type { AgentRunTracker, DbQueryTracker, ObservabilityPort, OutboundCallTracker, RequestTracker } from './ports.js';
const run = <T>(fn: () => T): T => fn();
const NOOP_TRACKER: RequestTracker = Object.freeze({ end(): void {}, run });
// One frozen tracker serves every non-request signal too: their end() outcomes differ only in type.
const NOOP_SIGNAL_TRACKER: DbQueryTracker & OutboundCallTracker & AgentRunTracker = Object.freeze({ end(): void {}, run });
const NOOP_PORTS = new WeakSet<ObservabilityPort>();
/** Creates disabled telemetry; every request shares one frozen tracker without allocation. */
export function createNoopObservabilityPort(_required: Record<string, never>): ObservabilityPort {
 const port: ObservabilityPort = {
  trackRequest: () => NOOP_TRACKER,
  trackDbQuery: () => NOOP_SIGNAL_TRACKER,
  trackOutboundCall: () => NOOP_SIGNAL_TRACKER,
  trackAgentRun: () => NOOP_SIGNAL_TRACKER,
 };
 NOOP_PORTS.add(port);
 return port;
}
/** True for a port this module built. Decorators use it to skip wrapping entirely when telemetry is
 * off, so a disabled install pays no per-query or per-call indirection, not merely no export. */
export function isNoopObservabilityPort(port: ObservabilityPort): boolean {
 return NOOP_PORTS.has(port);
}
