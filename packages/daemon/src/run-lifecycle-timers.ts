import { createConsoleLogger } from '@jini-ai/core/primitives';
import { isTerminalRunState } from '@jini-ai/protocol';
import { createInactivityWatchdog } from './close-status.js';
import type { InactivityWatchdog } from './close-status.js';
import type { EventLog } from './event-log.js';
import type { CreateRunLifecycleInput, RunLifecycle, RunLifecycleInternalErrorContext } from './run-lifecycle.js';
import type { RunRecord } from './run-lifecycle-registry.js';
import { clearIdempotencyIndexEntryIfMatching } from './run-lifecycle-registry.js';

/**
 * How long a just-terminal run should remain retained before its eviction timer fires: `retentionMs`
 * minus however much of that window has already elapsed since `terminalAt`. Floored at `0` so a run
 * that was already past its retention window when this is computed (relevant for `rehydrate()`,
 * where a run may have gone terminal long before this process started) schedules an immediate
 * eviction rather than a negative-delay timer. Pure.
 */
export function computeRetentionDelayMs({ terminalAt, retentionMs, now }: { readonly terminalAt: number; readonly retentionMs: number; readonly now: number }): number {
  return Math.max(0, retentionMs - (now - terminalAt));
}

/**
 * Arms `record.watchdog` when `timeoutMs` is configured — a no-op otherwise. `record` is typed as a
 * plain `{watchdog}` shape (not `Pick<RunRecord, 'watchdog'>`) purely so this function can be
 * exported without naming the private `RunRecord` type in a public signature.
 */
export function armWatchdogIfConfigured({ record, timeoutMs, onTimeout }: { readonly record: { watchdog: InactivityWatchdog | undefined }; readonly timeoutMs: number | undefined; readonly onTimeout: () => void }
): void {
  if (timeoutMs === undefined) return;
  record.watchdog = createInactivityWatchdog({ timeoutMs, onTimeout });
}

/**
 * Arms `record.slowRunWatchdog` when `timeoutMs` is configured — a no-op otherwise (the kernel-wide
 * opt-out: `CreateRunLifecycleInput.slowRunThresholdMs: null`). Deliberately a sibling of
 * {@link armWatchdogIfConfigured} rather than a shared helper: the two watchdogs are configured from
 * different inputs (a per-`start()` opt-in vs. a kernel-wide default) and their `onTimeout` callbacks
 * have opposite consequences for the run (terminates it vs. only reports a status), and folding them
 * into one parameterized function would obscure that asymmetry at every call site for the sake of a
 * three-line dedup. `record` is typed as a plain `{slowRunWatchdog}` shape for the same exportability
 * reason {@link armWatchdogIfConfigured} already documents.
 */
export function armSlowRunWatchdogIfConfigured({ record, timeoutMs, onTimeout }: { readonly record: { slowRunWatchdog: InactivityWatchdog | undefined }; readonly timeoutMs: number | undefined; readonly onTimeout: () => void }
): void {
  if (timeoutMs === undefined) return;
  record.slowRunWatchdog = createInactivityWatchdog({ timeoutMs, onTimeout });
}

export function createTerminalOrderRemoval({ terminalRunOrder }: { terminalRunOrder: string[] }) {
  function removeFromTerminalOrder(runId: string): void {
    const index = terminalRunOrder.indexOf(runId);
    if (index !== -1) terminalRunOrder.splice(index, 1);
  }
  return removeFromTerminalOrder;
}

export function createRunErrorReporter({ input }: { input: CreateRunLifecycleInput }) {
  /** Hands `context` to `onInternalError` (or `console.error`), containing a throwing sink. */
  function reportInternalError(context: RunLifecycleInternalErrorContext): void {
    try {
      if (input.onInternalError) input.onInternalError(context);
      else createConsoleLogger({ prefix: '' }).error({ message: `[@jini-ai/daemon] internal error (${context.source}, runId=${context.runId})` }, { error: context.error });
    } catch (sinkError) {
      createConsoleLogger({ prefix: '' }).error({ message: `[@jini-ai/daemon] internal error sink failed (${context.source}, runId=${context.runId})` }, { error: sinkError });
    }
  }
  return reportInternalError;
}

export function createEvictedRunEventDropper({ eventLog, reportInternalError }: { eventLog: EventLog; reportInternalError: ReturnType<typeof createRunErrorReporter> }) {
  /** `evictTerminalRun`'s opt-in event drop (see `CreateRunLifecycleInput.dropEventsOnEviction`). Runs from a timer, so a failure is reported, never thrown. */
  async function dropEvictedRunEvents(runId: string): Promise<void> {
    try {
      await eventLog.drop({ runId });
    } catch (error) {
      reportInternalError({ source: 'event-log-drop', runId, error });
    }
  }
  return dropEvictedRunEvents;
}

export function createTerminalRunEvictor({ removeFromTerminalOrder, runs, input, idempotencyIndex, dropEvictedRunEvents }: { removeFromTerminalOrder: ReturnType<typeof createTerminalOrderRemoval>; runs: Map<string, RunRecord>; input: CreateRunLifecycleInput; idempotencyIndex: Map<string, string>; dropEvictedRunEvents: ReturnType<typeof createEvictedRunEventDropper> }) {
  /**
   * Evicts a terminal run's in-memory record: drops it from `runs`, cleans its `idempotencyIndex`
   * entry (a stale entry would otherwise resolve `start()`'s idempotency replay to a run
   * `requireRun` can no longer find, turning a harmless re-post into a thrown error), and removes it
   * from `terminalRunOrder`. Called from a retention timer firing or from `enforceTerminalCap`. A
   * no-op if the run was already reclaimed by `resume()` (its timer is cancelled there) or evicted
   * by the other path (cap eviction can race a timer for the same run — only the first wins,
   * `runs.get` returns `undefined` for the second).
   */
  function evictTerminalRun(runId: string): void {
    removeFromTerminalOrder(runId);
    const record = runs.get(runId);
    if (!record) return;
    record.retentionTimer = undefined;
    runs.delete(runId);
    input.delegatedResultCorrelation?.clearRun({ runId });
    clearIdempotencyIndexEntryIfMatching({ idempotencyIndex: idempotencyIndex, idempotencyKey: record.idempotencyKey, runId: runId });
    if (input.dropEventsOnEviction === true) void dropEvictedRunEvents(runId);
  }
  return evictTerminalRun;
}

export function createTerminalCapEnforcer({ terminalRunOrder, maxTerminalRuns, evictTerminalRun }: { terminalRunOrder: string[]; maxTerminalRuns: number; evictTerminalRun: ReturnType<typeof createTerminalRunEvictor> }) {
  /** Trims the oldest terminal records until `terminalRunOrder` is back at or under `maxTerminalRuns`. */
  function enforceTerminalCap(): void {
    while (terminalRunOrder.length > maxTerminalRuns) {
      evictTerminalRun(terminalRunOrder[0]!);
    }
  }
  return enforceTerminalCap;
}

export function createTerminalRunTracker({ terminalRunOrder, terminalRetentionMs, evictTerminalRun, enforceTerminalCap }: { terminalRunOrder: string[]; terminalRetentionMs: number; evictTerminalRun: ReturnType<typeof createTerminalRunEvictor>; enforceTerminalCap: ReturnType<typeof createTerminalCapEnforcer> }) {
  /**
   * Arms `record`'s retention timer and enrolls it in `terminalRunOrder` — called once per run,
   * right when it first becomes terminal (from `finish()`) or when an already-terminal run is
   * rehydrated (from `rehydrateOne`). `terminalAt` is the real terminal timestamp (the durable
   * `'end'` entry's `recordedAt`), not "now": a rehydrated run may have gone terminal long before
   * this process started, and its remaining retention window must account for that instead of
   * restarting the full window on every restart.
   */
  function trackTerminalRun(runId: string, record: RunRecord, terminalAt: number): void {
    terminalRunOrder.push(runId);
    const delay = computeRetentionDelayMs({ terminalAt: terminalAt, retentionMs: terminalRetentionMs, now: Date.now() });
    const timer = setTimeout(() => evictTerminalRun(runId), delay);
    if (typeof timer.unref === 'function') timer.unref();
    record.retentionTimer = timer;
    enforceTerminalCap();
  }
  return trackTerminalRun;
}

export function createTerminalRunUntracker({ removeFromTerminalOrder }: { removeFromTerminalOrder: ReturnType<typeof createTerminalOrderRemoval> }) {
  /** Reverses `trackTerminalRun`: cancels the pending eviction and un-enrolls `runId`. Called from `resume()` so a reclaimed run cannot be evicted out from under its new, non-terminal life. */
  function untrackTerminalRun(runId: string, record: RunRecord): void {
    removeFromTerminalOrder(runId);
    if (record.retentionTimer) {
      clearTimeout(record.retentionTimer);
      record.retentionTimer = undefined;
    }
  }
  return untrackTerminalRun;
}

export function createInactivityTimeoutHandler({ input, getLifecycle }: { input: CreateRunLifecycleInput; getLifecycle: () => RunLifecycle }) {
  /**
   * Fires when a run's inactivity watchdog times out with no intervening
   * `emit()`/`finish()`. A deliberate watchdog kill is permanent: automatically restarting
   * it would undo the operator's inactivity policy. Other unexpected process failures still
   * retain their original runtime classification.
   *
   * There is deliberately no "run missing or already terminal" guard here (an earlier
   * `!record || isTerminalRunState(...)` guard was removed as unreachable through the public API,
   * and the handler needs nothing from the record — it acts through `lifecycle.emit`/`finish` by id):
   *
   * - terminal: every route to a terminal state runs through `finish()`, which
   *   calls `record.watchdog?.cancel()` and assigns `record.status.state` in the *same synchronous
   *   block* after its durable end append resolves. There is no interleaving point between the two,
   *   so "watchdog still armed" and "record already terminal" cannot both hold when this fires. (If
   *   the end append *throws*, the watchdog stays armed but the run also stays non-terminal.)
   * - missing: the only `runs.delete()` calls are `start()`'s unwind on a failed durable start
   *   append, which happens strictly before the watchdog is armed a few lines later, and terminal
   *   eviction, which only ever touches runs whose watchdog `finish()` already cancelled. And
   *   `createInactivityWatchdog` never calls `onTimeout` after `cancel()`.
   *
   * Note the "start/finish race" test below does *not* exercise this handler despite its name: by the
   * time it advances the timers, `finish()` has already cancelled the watchdog, so the callback
   * never runs at all. It still correctly asserts that no second `finish()` happens.
   */
  async function handleInactivityTimeout(runId: string): Promise<void> {
    try {
      // A deliberate inactivity kill is permanent for this attempt, not an auto-resume signal.
      await getLifecycle().emit({ runId, input: { event: 'agent', data: { type: 'status', label: 'Stopped by inactivity watchdog', detail: 'inactivity-watchdog' } } });
      await getLifecycle().finish({ runId, status: 'failed', code: null, signal: null, resumable: false });
    } catch (error) {
      const context: RunLifecycleInternalErrorContext = { source: 'inactivity-timeout', runId, error };
      try {
        if (input.onInternalError) {
          input.onInternalError(context);
        } else {
          createConsoleLogger({ prefix: '' }).error({ message: `[@jini-ai/daemon] internal error (inactivity-timeout, runId=${runId})` }, { error });
        }
      } catch (sinkError) {
        // A diagnostic sink must not turn a contained timer failure into another unhandled
        // rejection.
        createConsoleLogger({ prefix: '' }).error({ message: `[@jini-ai/daemon] internal error sink failed (inactivity-timeout, runId=${runId})` }, { error: sinkError });
      }
    }
  }
  return handleInactivityTimeout;
}

export function createSlowRunNoticeHandler({ input, getLifecycle }: { input: CreateRunLifecycleInput; getLifecycle: () => RunLifecycle }) {
  /**
   * Fires when a run's slow-run watchdog times out with no intervening `emit()` — the non-terminating
   * counterpart to {@link handleInactivityTimeout} above. Reports a `'slow_running'` agent event
   * through the ordinary `emit()` path rather than finishing the run: the run is left exactly as it
   * was, still `'running'`, so a legitimately slow-but-working turn is never mistaken for a dead one.
   * `'slow_running'` is its own `RunAgentPayload` variant, not a reuse of the pre-existing `'status'`
   * one — see that variant's own doc in `@jini-ai/protocol`'s `events.ts` for why: nothing in this
   * codebase renders `'status'` events today, so reusing it here would have shipped an invisible fix.
   *
   * Like {@link handleInactivityTimeout}, it has no "run missing or already terminal" guard (see
   * that function's doc for why such a guard is unreachable). One more case is worth naming:
   * `finish()` cancels `record.slowRunWatchdog` synchronously before its
   * `record.status.state` write ever yields, so between this timer firing and `emit()` actually
   * running there is no window where a normal `finish()` could race it — but `emit()` itself can
   * still legitimately throw (e.g. a `finishPromise` in flight from a concurrent `cancel()`-driven
   * finish that started after this callback fired but before its `emit()` call
   * completes its internal `await record.startPromise`), which is exactly what the `try`/`catch`
   * below contains rather than letting escape as an unhandled rejection.
   */
  async function handleSlowRunNotice(runId: string): Promise<void> {
    try {
      await getLifecycle().emit({ runId: runId, input: {
        event: 'agent',
        data: {
          type: 'slow_running',
          detail: 'Still working — this turn is taking longer than usual.',
        },
      } });
    } catch (error) {
      const context: RunLifecycleInternalErrorContext = { source: 'slow-run-notice', runId, error };
      try {
        if (input.onInternalError) {
          input.onInternalError(context);
        } else {
          createConsoleLogger({ prefix: '' }).error({ message: `[@jini-ai/daemon] internal error (slow-run-notice, runId=${runId})` }, { error });
        }
      } catch (sinkError) {
        // Same containment reasoning as `handleInactivityTimeout`'s own catch below it.
        createConsoleLogger({ prefix: '' }).error({ message: `[@jini-ai/daemon] internal error sink failed (slow-run-notice, runId=${runId})` }, { error: sinkError });
      }
    }
  }
  return handleSlowRunNotice;
}

export function createRunSuspendSlowRunNoticeMethod({ runs }: { runs: Map<string, RunRecord> }): RunLifecycle["suspendSlowRunNotice"] {
  return {
    suspendSlowRunNotice({ runId }: { readonly runId: string }): void {
      const record = runs.get(runId);
      if (!record || isTerminalRunState({ state: record.status.state })) return;
      record.slowRunSuspensions += 1;
      record.slowRunWatchdog?.cancel({});
    },
  }.suspendSlowRunNotice;
}

export function createRunResumeSlowRunNoticeMethod({ runs, slowRunThresholdMs, handleSlowRunNotice }: { runs: Map<string, RunRecord>; slowRunThresholdMs: number | undefined; handleSlowRunNotice: ReturnType<typeof createSlowRunNoticeHandler> }): RunLifecycle["resumeSlowRunNotice"] {
  return {
    resumeSlowRunNotice({ runId }: { readonly runId: string }): void {
      const record = runs.get(runId);
      if (!record || isTerminalRunState({ state: record.status.state })) return;
      // Re-arm only when the LAST open suspension closes (see `RunRecord.slowRunSuspensions`).
      if (record.slowRunSuspensions > 0) record.slowRunSuspensions -= 1;
      if (record.slowRunSuspensions > 0) return;
      // Suspension cancels permanently. Resuming must create a new window, never revive that handle.
      record.slowRunWatchdog?.cancel({});
      armSlowRunWatchdogIfConfigured({ record, timeoutMs: slowRunThresholdMs, onTimeout: () => {
        void handleSlowRunNotice(runId);
      } });
    },
  }.resumeSlowRunNotice;
}
