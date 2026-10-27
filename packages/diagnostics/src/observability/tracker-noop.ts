import type { Tracker, TrackerSpan } from "./tracker-types.js";

const SPAN: TrackerSpan<unknown> = Object.freeze({ setOutcome() {} });
const trace = async <T, Outcome>({ run }: { name: string; run: (span: TrackerSpan<Outcome>) => T | Promise<T> }): Promise<T> => run(SPAN);
const NOOP: Tracker = Object.freeze({ capture() {}, error() {}, metric() {}, activeTraceIds: () => undefined, trace: trace as Tracker["trace"] });

/** Shared inert facade for unconfigured hosts and optional collaborators. Work still runs once,
 * returning its result or original application error. No provider or process state is touched.
 * @complexity O(1) around the supplied callback. */
export function createNoopTracker(_required: Record<string, never>, _optional: Record<string, never> = {}): Tracker {
  return NOOP;
}
