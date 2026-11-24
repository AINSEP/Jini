import { observed } from "@jini-ai/core/errors/idioms";
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";
import { checkpointIntervalMs, checkpointProgress } from "../checkpoint-interval.js";

/**
 * @file Slices of a host's run finalizer: the ports its slices receive, the checkpointer, the checkpoint
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
// Checkpointer: saves a watched run's progress while it is still running — the growth test, the
// size-based cadence, the single pending write, the trailing timer and the backed-off retry.
// ---------------------------------------------------------------------------------------------

/** The fields of a host watch record the checkpointer reads and writes, and nothing else. The host
 * record may carry more (stream handles, ids, its own storage cursor); the checkpointer owns
 * only the `checkpoint*` fields, `trailing`, and reads `terminal` and `events`. A write that
 * completes late checks `terminal`; the host cancels `trailing` when it stops the watch. */
export interface CheckpointWatch {
  readonly runId: string;
  /** The projection source: events received so far on the current connection. */
  readonly events: readonly AgentEvent[];
  /** Saved payload size and start time of the latest checkpoint attempt (writes are best
   *  effort). The saved size picks the interval before the next one. */
  checkpointedAt: number;
  checkpointedBytes: number;
  /** Meaningful saved progress: status chatter and replayed tool identities do not qualify. */
  checkpointedTextCharacters: number;
  checkpointedExtensionEvents: number;
  checkpointedTools: Set<string>;
  /** Only one best-effort progress write at a time; later frames are coalesced into the next one. */
  checkpointPending: boolean;
  /** Failed writes cannot be retried by new frames before the backed-off deadline. */
  checkpointRetryAt?: number | undefined;
  /** Stops progress scheduling as soon as the terminal outcome is known, before its durable write. */
  terminal: boolean;
  /** Cancels the trailing checkpoint armed when the interval skipped one. */
  trailing?: (() => void) | undefined;
}

/** Every port is required: the checkpointer owns no clock, timer, storage or projection. */
export interface RunCheckpointerPorts<Watch extends CheckpointWatch, Saved> {
  /** Turns the watch's events into what is saved: the answer text and the event list to store.
   * The size of `events` selects the next interval. Pure; called once per write. */
  readonly project: (required: { events: readonly AgentEvent[] }, optional?: {}) => { content: string; events: Saved };
  /** One write on the host's own storage. Resolves `false` for a fenced or unchanged row (no retry),
   * rejects for a storage failure (backed-off retry). The host binds its own cursor on the watch. */
  readonly ledger: { checkpoint(required: { watch: Watch; content: string; events: Saved }, optional?: {}): Promise<boolean> };
  readonly now: () => number;
  /** The trailing and retry timer. It is separate from the deadline timers because the host does
   * not let it keep the process alive: a quiet run must not hold an idle site open. */
  readonly checkpointTimers: RunTimerPort;
  readonly log: Pick<RunLogPort, "error">;
  /** Override the size-based interval between in-flight checkpoints; tests pass 0. */
  readonly checkpointIntervalMs: number | undefined;
}

export interface RunCheckpointer<Watch extends CheckpointWatch> {
  /** Call after every frame that did not end the run. Never blocks frame consumption. */
  onFrame(required: { watch: Watch }, optional?: {}): void;
}

type Progress = ReturnType<typeof checkpointProgress>;
type Scope<Watch extends CheckpointWatch, Saved> = { ports: RunCheckpointerPorts<Watch, Saved>; watch: Watch };

function clearTrailing({ watch }: { watch: CheckpointWatch }, _options = {}): void {
  watch.trailing?.();
  watch.trailing = undefined;
}

/** One cancelable timer owns skipped frames and failed-write retries. Its callback reuses the
 * terminal, pending-write and unsaved-growth guards, including callbacks queued before cleanup.
 * @complexity O(1) time and space; replaces at most one timer per watch. */
function scheduleCheckpoint<Watch extends CheckpointWatch, Saved>(
  { ports, watch, delayMs }: Scope<Watch, Saved> & { delayMs: number }, _options = {},
): void {
  clearTrailing({ watch });
  watch.trailing = ports.checkpointTimers.schedule({ delayMs, run: () => {
    watch.trailing = undefined;
    void checkpoint({ ports, watch });
  } });
}

/** Failed storage writes retry during quiet tool/approval waits, at most once per interval and
 * never faster than once per second. False (fenced/unchanged) results do not retry.
 * @complexity O(events + tool identities) growth comparison; one timer per watch. */
function retryCheckpoint<Watch extends CheckpointWatch, Saved>(
  { ports, watch, interval }: Scope<Watch, Saved> & { interval: number }, _options = {},
): void {
  if (watch.terminal || !hasUnsavedCheckpointGrowth({ watch, progress: checkpointProgress({ events: watch.events }) })) return;
  const delayMs = Math.max(interval, 1_000);
  watch.checkpointRetryAt = ports.now() + delayMs;
  scheduleCheckpoint({ ports, watch, delayMs });
}

/**
 * Saves what the run has produced so far, when it has grown since the last save and the interval
 * has passed. Only growth counts: a reconnect replays from event 0, and a checkpoint of the
 * replay's first events would shrink the saved answer.
 *
 * A save the interval skips is not dropped: a trailing checkpoint is armed for the end of the
 * interval. Without it, a run that goes quiet (a long tool call) right after a skipped frame kept
 * its last text and tool-call start in memory only, lost on any stop — a process `exit` flush
 * cannot cover a graceful stop (an `exit` listener cannot await an async write).
 * At most one checkpoint is pending per run. It never blocks frame consumption: otherwise a
 * slow progress write holds an already-buffered `end` behind it, leaving a finished turn running
 * for startup repair to misclassify. Later progress is coalesced when the pending write finishes.
 * Terminal settlement uses the ledger's terminal guard to reject any late checkpoint.
 * The last saved payload selects the shared size-based interval (or an injected host override):
 * a merge fallback still rewrites the projection, so large turns need fewer checkpoints.
 *
 * This function decides; `writeCheckpoint` writes.
 * @complexity O(saved events) per write, with one pending write and one trailing timer per run.
 */
async function checkpoint<Watch extends CheckpointWatch, Saved>({ ports, watch }: Scope<Watch, Saved>, _optional = {}): Promise<void> {
  if (watch.terminal || watch.checkpointPending) return;
  const interval = ports.checkpointIntervalMs ?? checkpointIntervalMs({ bytes: watch.checkpointedBytes });
  const wait = Math.max(watch.checkpointedAt + interval, watch.checkpointRetryAt ?? Number.NEGATIVE_INFINITY) - ports.now();
  // An armed timer will consume the latest frames; avoid rescanning them on every delta.
  if (wait > 0 && watch.trailing) return;
  const progress = checkpointProgress({ events: watch.events });
  // Completion rechecks for coalesced frames. Do not arm a timer for an unchanged projection:
  // only unsaved growth should start the trailing deadline that protects a quiet run.
  if (!hasUnsavedCheckpointGrowth({ watch, progress })) return;
  if (wait > 0) {
    scheduleCheckpoint({ ports, watch, delayMs: wait });
    return;
  }
  await writeCheckpoint({ ports, watch, interval, progress });
}

/** The write `checkpoint` decided on: marks it pending, records what was saved, and on completion
 * picks up progress that arrived meanwhile.
 * @complexity O(saved events) for the projection and its size. */
async function writeCheckpoint<Watch extends CheckpointWatch, Saved>(
  { ports, watch, interval, progress }: Scope<Watch, Saved> & { interval: number; progress: Progress },
  _optional = {},
): Promise<void> {
  const { content, events } = ports.project({ events: watch.events });
  clearTrailing({ watch });
  watch.checkpointedAt = ports.now();
  watch.checkpointRetryAt = undefined;
  watch.checkpointPending = true;
  // Best effort: a failed checkpoint only loses what a restart would keep; the stream goes on.
  await ports.ledger
    .checkpoint({ watch, content, events })
    .then((written) => {
      if (!written) return;
      watch.checkpointedTextCharacters = progress.textCharacters;
      watch.checkpointedExtensionEvents = progress.extensionEvents;
      for (const key of progress.tools) watch.checkpointedTools.add(key);
      watch.checkpointedBytes = approximateJsonBytes({ value: events });
    })
    .catch((error: unknown) => {
      reportSafely({ report: () => ports.log.error({ operation: "checkpoint", runId: watch.runId, error }) });
      retryCheckpoint({ ports, watch, interval });
    })
    .finally(() => {
      watch.checkpointPending = false;
      // A false result (including a fenced row) or failure leaves the saved baseline behind.
      // Retrying that same attempt here spins at interval 0, or rearms forever at other intervals.
      // Only newer coalesced progress schedules from completion. Rejections alone also arm the
      // backed-off retry above, so quiet runs are protected without resurrecting the spin.
      if (!watch.terminal && checkpointGrew({ previous: progress, progress: checkpointProgress({ events: watch.events }) })) {
        void checkpoint({ ports, watch });
      }
    });
}

/** Instance-owned: the returned checkpointer keeps no state beyond the watches it is given.
 * @complexity O(1) to build; each frame costs what `checkpoint` documents. */
export function createRunCheckpointer<Watch extends CheckpointWatch, Saved>(
  { ports }: { ports: RunCheckpointerPorts<Watch, Saved> }, _optional = {},
): RunCheckpointer<Watch> {
  return { onFrame: ({ watch }, _options = {}) => { void checkpoint({ ports, watch }); } };
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
