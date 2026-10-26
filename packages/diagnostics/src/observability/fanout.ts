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

type Outcome<R> = { ok: true; value: R } | { ok: false; error: unknown };

const replay = <R>(outcome: Outcome<R>): R => {
 if (outcome.ok) return outcome.value;
 throw outcome.error;
};

/** A value a tracker returned instead of the recorded one is dropped; if it is a promise, its
 * rejection is observed here so dropping it never becomes an unhandled rejection. */
function discard(value: unknown): void {
 if (typeof (value as PromiseLike<unknown> | undefined)?.then === 'function') (value as Promise<unknown>).then(undefined, () => {});
}

/** One adapter's scope around `inner`, contained (Codex wave-2 MED): an adapter's run() that throws
 * before calling `inner` runs the work unscoped; one that throws after it keeps the work's own result
 * or error; one that returns without calling it still gets the work run. `inner` runs exactly once
 * (Codex fix-lane HIGH): its outcome is recorded, a second call from the tracker replays it instead of
 * re-running app work, and the caller always gets that recorded outcome, so a tracker that swallows
 * the work's error or substitutes a result cannot hide or change it. */
function containedScope<R>(run: <V>(fn: () => V) => V, inner: () => R): () => R {
 return () => {
  let outcome: Outcome<R> | undefined;
  const once = (): R => {
   if (!outcome) {
    try { outcome = { ok: true, value: inner() }; } catch (error) { outcome = { ok: false, error }; }
   }
   return replay(outcome);
  };
  let returned: unknown;
  try { returned = run(once); } catch { /* the adapter's own fault: contained */ }
  if (outcome?.ok !== true || returned !== outcome.value) discard(returned);
  return once();
 };
}

/** One tracker over several: run() nests every scope (so each adapter sees the work as its own
 * child), end() settles all. The first tracker's extra fields (a request id) are kept. Each end() is
 * isolated: one adapter throwing at settle time must neither skip the rest nor turn work that already
 * happened (a tool call that changed state) into a failed request for the caller. */
function combine<O, T extends Tracker<O>>(trackers: readonly T[]): T {
 const run = <R>(fn: () => R): R => trackers.reduceRight<() => R>((inner, t) => (t.run ? containedScope(t.run, inner) : inner), fn)();
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
 * dropped; none left returns the shared noop (still zero-cost). One left is still wrapped: returning
 * the raw port would let its throws (creating a tracker, ending it, reporting) reach the caller.
 * @param required The candidate ports, in nesting order (outermost first).
 * @returns A port; every signal reaches every adapter, and one adapter throwing (creating a tracker,
 *   ending it, or reporting) never skips the rest or reaches the caller.
 * @complexity O(n) per signal for n enabled adapters.
 */
export function combineObservabilityPorts({ ports }: { ports: readonly ObservabilityPort[] }): ObservabilityPort {
 const live = ports.filter((port) => !isNoopObservabilityPort(port));
 if (live.length === 0) return createNoopObservabilityPort({});
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
