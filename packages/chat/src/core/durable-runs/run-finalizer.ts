import { observed } from "@jini-ai/core/errors/idioms";
import type { checkpointProgress } from "../checkpoint-interval.js";

/**
 * @file Pure slices of a host's run finalizer: the ports its slices receive, the checkpoint
 * rules, the safe reporter call and the release of an unread events body. No clock, no timer,
 * no storage: the host's finalizer owns those and injects them through the ports below.
 */

// ---------------------------------------------------------------------------------------------
// Ports the run finalizer's slices receive from the host. Types only: the host decides what
// a timer and a log are, the slices only name the one call they need.
// ---------------------------------------------------------------------------------------------

/** Same required keys as the supervisor scheduler's `schedule`, restated here so a slice does not
 * import the scheduler's package. Returns the function that cancels the timer. */
export interface RunTimerPort { schedule(required: { delayMs: number; run: () => void }, optional?: {}): () => void }

/** Where the finalizer reports a failure it has already handled. Call it through `reportSafely`:
 * a host log may throw, and that must not change what happens to the run. */
export interface RunLogPort {
  /** A rejected checkpoint write (it is retried) or a watch that threw (it is abandoned). */
  error(required: { operation: "checkpoint" | "watch"; runId: string; error: unknown }, optional?: {}): void;
  /** The release of a daemon pin or the host's attempt-ended handler failed at a watch's end. */
  warn(required: { operation: "attempt-cleanup"; runId: string; error: unknown }, optional?: {}): void;
}

/** How a watch ended: the run's terminal status, `interrupted` when the watch handed the run to
 * recovery or gave it up as unproven, `abandoned` when the watch itself failed. */
export type RunWatchOutcome = "succeeded" | "failed" | "canceled" | "interrupted" | "abandoned";

// ---------------------------------------------------------------------------------------------
// Pure checkpoint rules of the run finalizer: how large a saved projection is, and whether
// a run has produced progress worth another write. No clock, no timer, no storage.
// ---------------------------------------------------------------------------------------------

/** The last successfully saved progress of a watch (fields of its `Watch` record). */
export interface SavedCheckpointProgress {
  readonly checkpointedTextCharacters: number;
  readonly checkpointedExtensionEvents: number;
  readonly checkpointedTools: Set<string>;
}

/**
 * String characters in a JSON-shaped value: a cheap lower bound of its serialized size, measured
 * without serializing it (the point is to avoid another multi-MB string per checkpoint).
 * @complexity O(nodes) time, O(depth) stack.
 */
export function approximateJsonBytes({ value }: { value: unknown }, _optional = {}): number {
  if (typeof value === "string") return value.length;
  if (value === null || typeof value !== "object") return 1;
  let total = 0;
  for (const item of Array.isArray(value) ? value : Object.values(value)) total += approximateJsonBytes({ value: item });
  return total;
}

/** Compare live progress with a successful or attempted checkpoint, including replayed tool ids.
 * @returns Whether unsaved meaningful progress needs a write or trailing timer; no side effects.
 * @complexity O(tool identities) time and space for the comparison. */
export function checkpointGrew(
  { previous, progress }: { previous: ReturnType<typeof checkpointProgress>; progress: ReturnType<typeof checkpointProgress> },
  _options = {},
): boolean {
  return progress.textCharacters > previous.textCharacters ||
    progress.extensionEvents > previous.extensionEvents ||
    [...progress.tools].some((key) => !previous.tools.has(key));
}

/** Compare with the last successful save, so replay prefixes and unchanged rows need no retry.
 * @complexity O(tool identities) comparison; does not serialize or mutate progress. */
export function hasUnsavedCheckpointGrowth({ watch, progress }: { watch: SavedCheckpointProgress; progress: ReturnType<typeof checkpointProgress> }, _options = {}): boolean {
  return checkpointGrew({ progress, previous: {
    textCharacters: watch.checkpointedTextCharacters,
    extensionEvents: watch.checkpointedExtensionEvents,
    tools: watch.checkpointedTools,
  } });
}

// ---------------------------------------------------------------------------------------------
// Calls a host reporter (a log or span port) so that its own failure cannot change what the
// run finalizer does next.
// ---------------------------------------------------------------------------------------------

/**
 * Runs one report call and contains whatever it throws, or rejects with when the host's reporter
 * turns out to be asynchronous.
 *
 * This is the one place the finalizer drops an error on purpose. The reporter is the only channel
 * its own failure could be reported through, and the alternative is worse: a throw from the log
 * call inside a checkpoint's rejection handler skips the backed-off retry and becomes an unhandled
 * rejection, and a throw from the log call at a watch's end rejects the watch itself.
 * @complexity O(1) beyond the reporter.
 */
export function reportSafely({ report }: { report: () => unknown }, _optional = {}): void {
  // The executor runs `report` synchronously and turns a synchronous throw into the same rejection
  // an asynchronous reporter produces, so one handler contains both.
  // Nothing to do with a failure, and nowhere left to say so: see the comment above.
  observed({ promise: new Promise<unknown>((resolve) => { resolve(report()); }) });
}

// ---------------------------------------------------------------------------------------------
// Unread events bodies.
// ---------------------------------------------------------------------------------------------

/** Releases an events response that will never be read. An unread body stays open, and a run
 * reconnects up to maxReconnects times. Not awaited: a body that never finishes cancelling must
 * not stall the watch. A failed cancel has nothing left to release.
 * @complexity O(1); starts one cancel and returns. */
export function releaseUnreadBody({ response }: { response: Response }, _optional = {}): void {
  const cancelling = response.body?.cancel();
  if (cancelling !== undefined) observed({ promise: cancelling });
}
