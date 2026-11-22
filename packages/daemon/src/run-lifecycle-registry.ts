import type { RunCancelRequest, RunProtocolEvent, RunState, RunStatus } from '@jini-ai/protocol';
import type { InactivityWatchdog } from './close-status.js';
import type { EventLogEntry } from './event-log.js';
import type { CreateRunLifecycleInput, RunLifecycle } from './run-lifecycle.js';

export interface RunRecord {
  contextRef: string | undefined;
  /** The idempotency key this run was started with, if any — retained (not just indexed) so terminal-retention eviction can clean its `idempotencyIndex` entry without a reverse lookup. */
  idempotencyKey: string | undefined;
  status: {
    id: string;
    state: RunState;
    startedAt: number;
    updatedAt: number;
    endedAt: number | undefined;
  };
  resumable: boolean;
  cancelRequested: boolean;
  /** The most recent cancellation request, if any — replayed to a listener that subscribes after `cancel()` already fired (see `onCancelRequested`). */
  lastCancelRequest: RunCancelRequest | undefined;
  cancelListeners: Set<(request: RunCancelRequest) => void>;
  subscribers: Set<(event: RunProtocolEvent) => void>;
  terminalWaiters: Array<(status: RunStatus) => void>;
  terminalEndEntry: EventLogEntry | undefined;
  watchdog: InactivityWatchdog | undefined;
  /**
   * Separate, non-terminating timer for the slow-run notice — reuses the same reset-on-activity
   * primitive as `watchdog` above, but its `onTimeout` emits a `'slow_running'` agent event instead
   * of finishing the run. Kept as its own field (not folded into `watchdog`) because the two can be
   * configured, armed, and cancelled independently: `watchdog` requires an explicit per-`start()`
   * opt-in (`StartRunInput.inactivityTimeoutMs`) and terminates the run on fire, while this one is
   * armed kernel-wide by default (`CreateRunLifecycleInput.slowRunThresholdMs`) and never terminates
   * anything. See {@link armSlowRunWatchdogIfConfigured}.
   */
  slowRunWatchdog: InactivityWatchdog | undefined;
  /**
   * How many {@link RunLifecycle.suspendSlowRunNotice} calls are still open for this run. A count,
   * not a flag: two delegated calls can be in flight at once (one parked on a human's form, one a
   * plain tool), and the first to finish must not re-arm the notice over the other's open form.
   */
  slowRunSuspensions: number;
  /** Pending durable start append; idempotent duplicates wait for it instead of observing a ghost record. */
  startPromise: Promise<void> | undefined;
  /** Serializes concurrent terminal transitions while state remains non-terminal until the end append commits. */
  finishPromise: Promise<RunStatus> | undefined;
  /** Armed while this run is terminal and retained, pending eviction from `runs`/`idempotencyIndex` — see the terminal-retention helpers below. `undefined` for a non-terminal run, or a terminal one `resume()` has reclaimed. */
  retentionTimer: ReturnType<typeof setTimeout> | undefined;
}

export function toPublicStatus(record: RunRecord): RunStatus {
  const status: RunStatus = {
    id: record.status.id,
    state: record.status.state,
    startedAt: record.status.startedAt,
    updatedAt: record.status.updatedAt,
  };
  if (record.status.endedAt !== undefined) {
    return { ...status, endedAt: record.status.endedAt };
  }
  return status;
}

// ---------------------------------------------------------------------------
// start()/stream() phase helpers
//
// `start()` and `stream()` were each over the complexity gate (cyclomatic 12/13,
// cognitive 12/12). Both are broken up the same way: pure/near-pure pieces with
// real branching extracted to named, independently-testable top-level functions
// (typed against plain object shapes rather than the private `RunRecord`, so
// they can be exported without leaking that internal type), leaving each method
// itself a flat sequence with only its two or three irreducible guard clauses.
// ---------------------------------------------------------------------------

/**
 * `start()`'s idempotency-replay lookup: the run id an existing `idempotencyKey` already maps to,
 * or `undefined` when there is no key or no existing mapping (a fresh start proceeds normally).
 * Pure.
 */
export function resolveIdempotentReplayRunId({ idempotencyIndex, idempotencyKey }: { readonly idempotencyIndex: ReadonlyMap<string, string>; readonly idempotencyKey: string | undefined }
): string | undefined {
  if (idempotencyKey === undefined) return undefined;
  return idempotencyIndex.get(idempotencyKey);
}

/** Registers `runId` under `idempotencyKey` in `idempotencyIndex` — a no-op when no key was supplied. */
export function registerIdempotencyKeyIfPresent({ idempotencyIndex, idempotencyKey, runId }: { readonly idempotencyIndex: Map<string, string>; readonly idempotencyKey: string | undefined; readonly runId: string }
): void {
  if (idempotencyKey === undefined) return;
  idempotencyIndex.set(idempotencyKey, runId);
}

/**
 * Removes `idempotencyKey`'s mapping from `idempotencyIndex`, but only when it still points at
 * `runId` — used to roll back a failed durable `'start'` append without clobbering a different
 * run that may have since claimed the same key (defensive; `start()`'s own locking makes that
 * race unreachable today, but the check costs nothing and documents the invariant).
 */
export function clearIdempotencyIndexEntryIfMatching({ idempotencyIndex, idempotencyKey, runId }: { readonly idempotencyIndex: Map<string, string>; readonly idempotencyKey: string | undefined; readonly runId: string }
): void {
  if (idempotencyKey !== undefined && idempotencyIndex.get(idempotencyKey) === runId) {
    idempotencyIndex.delete(idempotencyKey);
  }
}

/**
 * Default terminal-run retention window: how long a completed/failed/cancelled run's in-memory
 * record stays readable via `get`/`list`/`stream`/`resume` before eviction. `runs.set()` never had
 * a matching `runs.delete()` for a run that finishes normally — every terminal run's record was kept
 * for the daemon process's entire lifetime, unbounded by run volume or uptime. Terminal runs are
 * still read after they end (status polling, run-history listing, stream reconnects), so the fix
 * cannot be "delete on completion" — this bounds *how long* a terminal record survives instead of
 * deleting it immediately. 24h comfortably covers same-day polling/listing/reconnect without
 * retaining every run a long-lived daemon ever processed.
 */
export const DEFAULT_TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Default hard cap on concurrently-retained terminal run records, independent of
 * {@link DEFAULT_TERMINAL_RETENTION_MS} — the oldest terminal record is evicted once this is
 * exceeded. A TTL alone does not bound memory when runs complete faster than they age out (a burst
 * arriving within the retention window keeps growing); this cap gives a true worst-case bound
 * regardless of arrival rate.
 */
export const DEFAULT_MAX_TERMINAL_RUNS = 1000;

/**
 * Default wall-clock threshold for the slow-run notice (distinct from the crash/inactivity watchdog
 * above): how long a run may go with no agent-event `emit()` (excluding the notice itself) before a `'slow_running'` agent event tells the UI
 * "this is taking longer than usual," without ever finishing the run. See {@link armSlowRunWatchdogIfConfigured}'s
 * doc for the full "why a second, non-terminating watchdog" rationale. 45s was picked as long enough
 * that an ordinary quiet stretch (the agent thinking between tool calls, a slow but healthy model
 * response) does not trip it on every turn, and short enough that a genuinely stalled run (the
 * reported symptom: a spawned CLI process alive but starved of CPU under heavy concurrent load, so it
 * never crashes and never gets caught by anything that only reacts to process exit) is flagged well
 * before an operator gives up waiting and assumes the product is broken.
 */
export const DEFAULT_SLOW_RUN_THRESHOLD_MS = 45_000;

export function createRunRegistry(input: CreateRunLifecycleInput) {
  const { eventLog } = input;
  const terminalRetentionMs = input.terminalRetentionMs ?? DEFAULT_TERMINAL_RETENTION_MS;
  const maxTerminalRuns = input.maxTerminalRuns ?? DEFAULT_MAX_TERMINAL_RUNS;
  // `null` is the explicit opt-out; `undefined` (the field simply omitted, true of every production
  // caller today) resolves to the default so the slow-run notice reaches production with no caller
  // change required — see `CreateRunLifecycleInput.slowRunThresholdMs`'s own doc.
  const slowRunThresholdMs = input.slowRunThresholdMs === null ? undefined : (input.slowRunThresholdMs ?? DEFAULT_SLOW_RUN_THRESHOLD_MS);
  const runs = new Map<string, RunRecord>();
  const idempotencyIndex = new Map<string, string>();
  // Terminal runIds in the order they were tracked (oldest first) — the LRU order `enforceTerminalCap`
  // trims from. A run leaves this list exactly once, either via its retention timer firing or via
  // `resume()` reclaiming it; see `evictTerminalRun`/`untrackTerminalRun`.
  const terminalRunOrder: string[] = [];

  return { eventLog, terminalRetentionMs, maxTerminalRuns, slowRunThresholdMs, runs, idempotencyIndex, terminalRunOrder };
}

/**
 * Waits out a record's in-flight durable `'start'` append, swallowing its failure.
 *
 * The read-only queries (`get`/`list`) use this so they never observe the window in which the
 * in-memory record exists but its durable `'start'` entry does not: a rejecting append unwinds the
 * record entirely, so anything reported from inside that window is a run that never existed. The
 * rejection itself belongs to `start()`'s own caller, which is why it is dropped here rather than
 * propagated out of a query that was only asked "what runs are there".
 */
async function settlePendingStart(record: RunRecord | undefined): Promise<void> {
  if (record?.startPromise === undefined) return;
  try {
    await record.startPromise;
  } catch {
    // Reported to `start()`'s caller — see above.
  }
}

export function createRunLookup({ runs }: { runs: Map<string, RunRecord> }) {
  function requireRun(runId: string): RunRecord {
    const record = runs.get(runId);
    if (!record) {
      throw new Error(`RunLifecycle: unknown run "${runId}"`);
    }
    return record;
  }
  return requireRun;
}

export function createRunGetMethod({ runs }: { runs: Map<string, RunRecord> }): RunLifecycle["get"] {
  return {
    async get({ runId }: { readonly runId: string }): Promise<RunStatus | undefined> {
      await settlePendingStart(runs.get(runId));
      // Re-read rather than reusing the record above: a failed start deletes it (see `start()`'s
      // unwind), and reporting a run whose durable `'start'` entry does not exist would advertise a
      // run no restart could ever rehydrate.
      const record = runs.get(runId);
      return record ? toPublicStatus(record) : undefined;
    },
  }.get;
}

export function createRunListMethod({ runs }: { runs: Map<string, RunRecord> }): RunLifecycle["list"] {
  return {
    async list(_requiredArgs: Record<string, never>, { contextRef }: { readonly contextRef?: string } = {}): Promise<readonly RunStatus[]> {
      await Promise.all(Array.from(runs.values(), settlePendingStart));
      const all = Array.from(runs.values());
      const filtered = contextRef === undefined ? all : all.filter((record) => record.contextRef === contextRef);
      return filtered.map(toPublicStatus);
    },
  }.list;
}
