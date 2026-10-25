import type { ObservabilityPort, TrackerScope } from './ports.js';
import { createNoopObservabilityPort, isNoopObservabilityPort } from './noop.js';

type Tracker<O> = Partial<TrackerScope> & { end(outcome: O): void };

/** One tracker over several: run() nests every scope (so each adapter sees the work as its own
 * child), end() settles all. The first tracker's extra fields (a request id) are kept. */
function combine<O, T extends Tracker<O>>(trackers: readonly T[]): T {
 const run = <R>(fn: () => R): R => trackers.reduceRight<() => R>((inner, t) => (t.run ? () => t.run!(inner) : inner), fn)();
 return { ...trackers[0]!, run, end: (outcome: O) => { for (const t of trackers) t.end(outcome); } };
}

/**
 * Sends every signal to each enabled adapter: the "both configured" answer (say OpenTelemetry for
 * traces and an error tracker for incidents), with no adapter knowing about the other. Noop ports are
 * dropped; none left returns the shared noop (still zero-cost), one left is returned as-is, so a
 * single-adapter install pays nothing for this either. Only two or more allocate a combined tracker.
 * @param required The candidate ports, in nesting order (outermost first).
 * @returns A port; reportError reaches every adapter, and one adapter throwing never skips the rest.
 * @complexity O(n) per signal for n enabled adapters.
 */
export function combineObservabilityPorts({ ports }: { ports: readonly ObservabilityPort[] }): ObservabilityPort {
 const live = ports.filter((port) => !isNoopObservabilityPort(port));
 if (live.length === 0) return createNoopObservabilityPort({});
 if (live.length === 1) return live[0]!;
 return {
  trackRequest: (input, options) => combine(live.map((p) => p.trackRequest(input, options))),
  trackDbQuery: (input) => combine(live.map((p) => p.trackDbQuery(input))),
  trackOutboundCall: (input) => combine(live.map((p) => p.trackOutboundCall(input))),
  trackAgentRun: (input, options) => combine(live.map((p) => p.trackAgentRun(input, options))),
  trackOperation: (input) => combine(live.map((p) => p.trackOperation(input))),
  reportError: (report) => {
   for (const port of live) { try { port.reportError(report); } catch { /* reportError never throws; keep reaching the rest */ } }
  },
 };
}
