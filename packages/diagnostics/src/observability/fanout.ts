import type { ObservabilityPort, TrackerScope } from './ports.js';
import { createNoopObservabilityPort, isNoopObservabilityPort } from './noop.js';

type Tracker<O> = Partial<TrackerScope> & { end(outcome: O): void };
type Signal = 'trackRequest' | 'trackDbQuery' | 'trackOutboundCall' | 'trackAgentRun' | 'trackOperation';

const NOOP = createNoopObservabilityPort({});

/** One adapter's tracker, isolated (review 2026-10-25 #3): an adapter that throws while CREATING its
 * tracker gets the shared noop tracker for this signal instead of failing the caller's work, so the
 * other adapters still see it. */
function isolatedStart<T>(start: () => T, fallback: () => T): T {
 try { return start(); } catch { return fallback(); }
}

/** One tracker over several: run() nests every scope (so each adapter sees the work as its own
 * child), end() settles all. The first tracker's extra fields (a request id) are kept. Each end() is
 * isolated: one adapter throwing at settle time must neither skip the rest nor turn work that already
 * happened (a tool call that changed state) into a failed request for the caller. */
function combine<O, T extends Tracker<O>>(trackers: readonly T[]): T {
 const run = <R>(fn: () => R): R => trackers.reduceRight<() => R>((inner, t) => (t.run ? () => t.run!(inner) : inner), fn)();
 const end = (outcome: O) => { for (const t of trackers) { try { t.end(outcome); } catch { /* settle the rest */ } } };
 return { ...trackers[0]!, run, end };
}

/** Starts the same signal on every live adapter, each isolated, and combines the trackers. */
function fanOut<K extends Signal>(live: readonly ObservabilityPort[], signal: K, args: Parameters<ObservabilityPort[K]>): ReturnType<ObservabilityPort[K]> {
 type Start = (...a: Parameters<ObservabilityPort[K]>) => ReturnType<ObservabilityPort[K]>;
 const trackers = live.map((port) => isolatedStart(() => (port[signal] as Start)(...args), () => (NOOP[signal] as Start)(...args)));
 return combine(trackers as unknown as Tracker<unknown>[]) as ReturnType<ObservabilityPort[K]>;
}

/**
 * Sends every signal to each enabled adapter: the "both configured" answer (say OpenTelemetry for
 * traces and an error tracker for incidents), with no adapter knowing about the other. Noop ports are
 * dropped; none left returns the shared noop (still zero-cost), one left is returned as-is, so a
 * single-adapter install pays nothing for this either. Only two or more allocate a combined tracker.
 * @param required The candidate ports, in nesting order (outermost first).
 * @returns A port; every signal reaches every adapter, and one adapter throwing (creating a tracker,
 *   ending it, or reporting) never skips the rest or reaches the caller.
 * @complexity O(n) per signal for n enabled adapters.
 */
export function combineObservabilityPorts({ ports }: { ports: readonly ObservabilityPort[] }): ObservabilityPort {
 const live = ports.filter((port) => !isNoopObservabilityPort(port));
 if (live.length === 0) return createNoopObservabilityPort({});
 if (live.length === 1) return live[0]!;
 return {
  trackRequest: (...args) => fanOut(live, 'trackRequest', args),
  trackDbQuery: (...args) => fanOut(live, 'trackDbQuery', args),
  trackOutboundCall: (...args) => fanOut(live, 'trackOutboundCall', args),
  trackAgentRun: (...args) => fanOut(live, 'trackAgentRun', args),
  trackOperation: (...args) => fanOut(live, 'trackOperation', args),
  reportError: (report) => {
   for (const port of live) { try { port.reportError(report); } catch { /* reportError never throws; keep reaching the rest */ } }
  },
 };
}
