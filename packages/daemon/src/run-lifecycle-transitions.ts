import { isTerminalRunState } from '@jini-ai/protocol';
import type { RunCancelRequest, RunEndPayload, RunStatus } from '@jini-ai/protocol';
import type { TerminalRunOutcome } from './close-status.js';
import type { EventLog } from './event-log.js';
import type { FinishRunInput, ResumeRunResult, RunLifecycle, Unsubscribe } from './run-lifecycle.js';
import { notifySubscribers, toRunEvent } from './run-lifecycle-events.js';
import type { RunRecord, createRunLookup } from './run-lifecycle-registry.js';
import { toPublicStatus } from './run-lifecycle-registry.js';
import type { createSlowRunNoticeHandler, createTerminalRunTracker, createTerminalRunUntracker } from './run-lifecycle-timers.js';
import { armSlowRunWatchdogIfConfigured } from './run-lifecycle-timers.js';

/** Vocabulary-firewall bridge: `RunState` uses `'cancelled'` (extraction-plan §12 C5's own cited canary), `RunEndPayload.status` uses `'canceled'`. Both live in `@jini-ai/protocol`, which is out of scope for this task — bridged here rather than fixed upstream. */
const TERMINAL_OUTCOME_TO_END_STATUS: Record<TerminalRunOutcome, NonNullable<RunEndPayload['status']>> = {
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'canceled',
};

/** Settles like `promise`, or rejects with the signal's reason once it aborts; the listener is always released. */
function abortable({ promise }: { promise: Promise<unknown> | undefined }, { signal }: { signal: AbortSignal | undefined }): Promise<unknown> {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = (): void => { reject(signal.reason); };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => { signal.removeEventListener('abort', onAbort); });
  });
}

/** Registers a terminal waiter; an abort removes it again so a cancelled wait retains nothing. */
function parkTerminalWaiter({ record }: { record: RunRecord }, { signal }: { signal: AbortSignal | undefined }): Promise<RunStatus> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      const index = record.terminalWaiters.indexOf(waiter);
      if (index >= 0) record.terminalWaiters.splice(index, 1);
      reject(signal?.reason);
    };
    const waiter = (status: RunStatus): void => {
      signal?.removeEventListener('abort', onAbort);
      resolve(status);
    };
    record.terminalWaiters.push(waiter);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function resolveTerminalWaiters(record: RunRecord): void {
  const waiters = record.terminalWaiters.splice(0, record.terminalWaiters.length);
  const status = toPublicStatus(record);
  for (const resolve of waiters) {
    resolve(status);
  }
}

export function createRunCancelMethod({ requireRun }: { requireRun: ReturnType<typeof createRunLookup> }): RunLifecycle["cancel"] {
  return {
    async cancel(request: RunCancelRequest): Promise<RunStatus> {
      const record = requireRun(request.runId);
      await record.startPromise;
      if (record.finishPromise) {
        return record.finishPromise;
      }
      if (isTerminalRunState({ state: record.status.state })) {
        return toPublicStatus(record);
      }
      record.cancelRequested = true;
      record.lastCancelRequest = request;
      record.status.updatedAt = Date.now();
      for (const listener of record.cancelListeners) {
        listener(request);
      }
      return toPublicStatus(record);
    },
  }.cancel;
}

export function createRunOnCancelRequestedMethod({ requireRun }: { requireRun: ReturnType<typeof createRunLookup> }): RunLifecycle["onCancelRequested"] {
  return {
    /**
     * Registers a cancel-intent listener. If `cancel()` was already called
     * for this run before this subscription, the listener fires immediately
     * with the original request (mirrors `AbortSignal`'s `aborted`+`addEventListener`
     * pairing) — otherwise a driver that attaches after the cancel already
     * happened would silently never learn about it, since a plain
     * subscribe-for-future-events registry has no memory of past firings.
     */
    onCancelRequested({ runId, listener }: { readonly runId: string; readonly listener: (request: RunCancelRequest) => void }): Unsubscribe {
      const record = requireRun(runId);
      if (record.cancelRequested && record.lastCancelRequest) {
        listener(record.lastCancelRequest);
      }
      record.cancelListeners.add(listener);
      return () => record.cancelListeners.delete(listener);
    },
  }.onCancelRequested;
}

export function createRunFinishMethod({ requireRun, eventLog, trackTerminalRun }: { requireRun: ReturnType<typeof createRunLookup>; eventLog: EventLog; trackTerminalRun: ReturnType<typeof createTerminalRunTracker> }): RunLifecycle["finish"] {
  return {
    async finish(requiredArgs: Pick<FinishRunInput, "runId" | "status" | "code" | "signal" | "resumable">, optionalArgs: Pick<FinishRunInput, "sessionRef"> = {}): Promise<RunStatus> {
  const finishInput: FinishRunInput = { ...requiredArgs, ...optionalArgs };
      const record = requireRun(finishInput.runId);
      await record.startPromise;
      if (record.finishPromise) {
        return record.finishPromise;
      }
      if (isTerminalRunState({ state: record.status.state })) {
        return toPublicStatus(record);
      }
      const finishing = (async (): Promise<RunStatus> => {
        const endPayload: RunEndPayload = {
          code: finishInput.code,
          signal: finishInput.signal,
          status: TERMINAL_OUTCOME_TO_END_STATUS[finishInput.status],
          resumable: finishInput.resumable,
          ...(finishInput.sessionRef !== undefined ? { sessionRef: finishInput.sessionRef } : {}),
        };
        const endEntry = await eventLog.append({ runId: finishInput.runId, event: 'end', data: endPayload });

        // Commit the in-memory terminal transition only after its durable end entry exists. Until
        // then `finishPromise` reserves the transition and blocks emits/concurrent finishes.
        record.watchdog?.cancel({});
        record.slowRunWatchdog?.cancel({});
        record.status.state = finishInput.status;
        record.status.updatedAt = endEntry.recordedAt;
        record.status.endedAt = endEntry.recordedAt;
        record.resumable = finishInput.resumable;
        record.terminalEndEntry = endEntry;
        trackTerminalRun(finishInput.runId, record, endEntry.recordedAt);
        const endEvent = toRunEvent({ runId: finishInput.runId, entry: endEntry });
        notifySubscribers(record, endEvent);

        resolveTerminalWaiters(record);
        return toPublicStatus(record);
      })();
      record.finishPromise = finishing;
      try {
        return await finishing;
      } finally {
        if (record.finishPromise === finishing) {
          record.finishPromise = undefined;
        }
      }
    },
  }.finish;
}

export function createRunResumeMethod({ requireRun, untrackTerminalRun, slowRunThresholdMs, handleSlowRunNotice }: { requireRun: ReturnType<typeof createRunLookup>; untrackTerminalRun: ReturnType<typeof createTerminalRunUntracker>; slowRunThresholdMs: number | undefined; handleSlowRunNotice: ReturnType<typeof createSlowRunNoticeHandler> }): RunLifecycle["resume"] {
  return {
    async resume({ runId }: { readonly runId: string }): Promise<ResumeRunResult> {
      const record = requireRun(runId);
      const eligible = isTerminalRunState({ state: record.status.state }) && record.resumable;
      if (!eligible) {
        return { run: toPublicStatus(record), resumed: false };
      }
      untrackTerminalRun(runId, record);
      const now = Date.now();
      record.status.state = 'running';
      record.status.updatedAt = now;
      record.status.endedAt = undefined;
      record.resumable = false;
      record.cancelRequested = false;
      record.lastCancelRequest = undefined;
      record.terminalEndEntry = undefined;
      // Mirrors `start()`'s own arm call: a resumed run gets exactly the same fresh slow-run window a
      // freshly-started one does. Without this, `finish()`'s `record.slowRunWatchdog?.cancel()` (which
      // never fires again on its own — the underlying timer is one-shot) left the notice permanently
      // dark for the rest of a resumed run's life, silently disabling a feature the run is otherwise
      // still eligible for. Suspensions left open when the run ended can never be resumed (resume is a
      // no-op on a terminal run), so they are dropped here or they would keep the notice dark forever.
      record.slowRunSuspensions = 0;
      armSlowRunWatchdogIfConfigured({ record: record, timeoutMs: slowRunThresholdMs, onTimeout: () => {
        void handleSlowRunNotice(runId);
      } });
      // No protocol event is emitted here: none of RunProtocolEvent's six
      // kinds represents "resumed" (extraction-plan scope decision — see
      // archived provenance ledger). The event log's cursor sequence continues
      // unbroken; only RunStatus.state changes.
      return { run: toPublicStatus(record), resumed: true };
    },
  }.resume;
}

export function createRunWaitForTerminalMethod({ requireRun }: { requireRun: ReturnType<typeof createRunLookup> }): RunLifecycle["waitForTerminal"] {
  return {
    async waitForTerminal({ runId }: { readonly runId: string }, { signal }: { readonly signal?: AbortSignal } = {}): Promise<RunStatus> {
      const record = requireRun(runId);
      // Awaited (and *propagated*, unlike in `get`/`list`) before any waiter is registered. A run
      // whose durable start append rejects is unwound, and nothing ever calls `finish()` for it — so
      // a waiter parked inside that window would never be resolved by anyone. Failing the wait with
      // the same error that failed the start is the only honest terminal answer, and awaiting first
      // means `terminalWaiters` can only ever hold waiters for a run that really does exist.
      // The abort signal is observed during that wait too: a stalled start append must not strand
      // a caller that has already given up (a pre-aborted signal rejects at once).
      await abortable({ promise: record.startPromise }, { signal });
      if (isTerminalRunState({ state: record.status.state })) {
        return toPublicStatus(record);
      }
      return parkTerminalWaiter({ record }, { signal });
    },
  }.waitForTerminal;
}
