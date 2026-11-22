import { randomUUID } from 'node:crypto';
import type { RunStartPayload } from '@jini-ai/protocol';
import type { TerminalRunOutcome } from './close-status.js';
import type { EventLog, EventLogEntry } from './event-log.js';
import type { CreateRunLifecycleInput, RunLifecycle, StartRunInput, StartRunResult } from './run-lifecycle.js';
import type { createRunEventWriter } from './run-lifecycle-events.js';
import type { RunRecord, createRunLookup } from './run-lifecycle-registry.js';
import {
  clearIdempotencyIndexEntryIfMatching,
  registerIdempotencyKeyIfPresent,
  resolveIdempotentReplayRunId,
  toPublicStatus,
} from './run-lifecycle-registry.js';
import type { createInactivityTimeoutHandler, createSlowRunNoticeHandler, createTerminalRunTracker } from './run-lifecycle-timers.js';
import { armSlowRunWatchdogIfConfigured, armWatchdogIfConfigured } from './run-lifecycle-timers.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the two run-level fields the kernel persists on a run's `'start'` entry. Both are absent
 * on a log whose start entry carried a non-record payload (or no start entry at all).
 */
function readStartMetadata(startEntry: EventLogEntry | undefined): {
  contextRef: string | undefined;
  idempotencyKey: string | undefined;
} {
  const startData = startEntry && isRecord(startEntry.data) ? startEntry.data : null;
  return {
    contextRef: typeof startData?.contextRef === 'string' ? startData.contextRef : undefined,
    idempotencyKey: typeof startData?.idempotencyKey === 'string' ? startData.idempotencyKey : undefined,
  };
}

/** Rebuilds the public status block for a rehydrated run from its first/last/start/end log entries. */
function rehydratedStatus(
  runId: string,
  bounds: {
    startEntry: EventLogEntry | undefined;
    endEntry: EventLogEntry | undefined;
    firstEntry: EventLogEntry;
    lastEntry: EventLogEntry;
    terminal: { state: TerminalRunOutcome; resumable: boolean } | null;
  },
): RunRecord['status'] {
  return {
    id: runId,
    state: bounds.terminal?.state ?? 'running',
    startedAt: bounds.startEntry?.recordedAt ?? bounds.firstEntry.recordedAt,
    updatedAt: bounds.lastEntry.recordedAt,
    endedAt: bounds.endEntry?.recordedAt,
  };
}

/**
 * Rebuilds one in-memory `RunRecord` from a run's replayed durable entries. Volatile fields
 * (listeners, subscribers, watchdog, in-flight promises) cannot survive a restart and are reset.
 */
function rehydratedRunRecord(
  runId: string,
  entries: readonly EventLogEntry[],
): { record: RunRecord; idempotencyKey: string | undefined; terminalAt: number | undefined } {
  const startEntry = entries.find((entry) => entry.event === 'start');
  const endEntry = [...entries].reverse().find((entry) => entry.event === 'end');
  const firstEntry = entries[0]!;
  const lastEntry = entries[entries.length - 1]!;
  const terminal = endEntry === undefined ? null : terminalStateFromEndEntry(endEntry);
  const { contextRef, idempotencyKey } = readStartMetadata(startEntry);
  return {
    record: {
      contextRef,
      idempotencyKey,
      status: rehydratedStatus(runId, { startEntry, endEntry, firstEntry, lastEntry, terminal }),
      resumable: terminal?.resumable ?? false,
      cancelRequested: false,
      lastCancelRequest: undefined,
      cancelListeners: new Set(),
      subscribers: new Set(),
      terminalWaiters: [],
      terminalEndEntry: endEntry,
      watchdog: undefined,
      slowRunWatchdog: undefined,
      slowRunSuspensions: 0,
      startPromise: undefined,
      finishPromise: undefined,
      retentionTimer: undefined,
    },
    idempotencyKey,
    // Terminal exactly when the log holds an 'end' entry (`terminal` is derived from it), so the
    // end entry's own timestamp is the terminal time — never a "now" substitute.
    terminalAt: endEntry?.recordedAt,
  };
}

function terminalStateFromEndEntry(entry: EventLogEntry): { state: TerminalRunOutcome; resumable: boolean } {
  if (!isRecord(entry.data)) return { state: 'failed', resumable: false };
  const status = entry.data.status;
  const unsuccessful: TerminalRunOutcome = status === 'canceled' ? 'cancelled' : 'failed';
  const state: TerminalRunOutcome = status === 'succeeded' ? 'succeeded' : unsuccessful;
  return { state, resumable: entry.data.resumable === true };
}

/** The durable `'start'` entry's payload — pure field mapping, split out of `start()` so its two optional-field spreads don't count toward that method's own complexity. */
export function buildStartPayload({ runId, startInput }: { readonly runId: string; readonly startInput: Pick<StartRunInput, 'contextRef' | 'agentId' | 'idempotencyKey'> }
): RunStartPayload {
  return {
    runId,
    contextRef: startInput.contextRef,
    ...(startInput.agentId !== undefined ? { agentId: startInput.agentId } : {}),
    ...(startInput.idempotencyKey !== undefined ? { idempotencyKey: startInput.idempotencyKey } : {}),
  };
}

/**
 * Constructs a fresh in-memory `RunRecord` for a new `start()` call. Pure field mapping with no
 * branches at all — not exported (would leak the private `RunRecord` type), kept as a named
 * function purely so `start()` itself reads as "build the record, register it" rather than an
 * 11-field literal inline.
 */
function buildNewRunRecord(
  startInput: Pick<StartRunInput, 'contextRef' | 'idempotencyKey'>,
  runId: string,
  now: number,
): RunRecord {
  return {
    contextRef: startInput.contextRef,
    idempotencyKey: startInput.idempotencyKey,
    status: { id: runId, state: 'running', startedAt: now, updatedAt: now, endedAt: undefined },
    resumable: false,
    cancelRequested: false,
    lastCancelRequest: undefined,
    cancelListeners: new Set(),
    subscribers: new Set(),
    terminalWaiters: [],
    terminalEndEntry: undefined,
    watchdog: undefined,
    slowRunWatchdog: undefined,
    slowRunSuspensions: 0,
    startPromise: undefined,
    finishPromise: undefined,
    retentionTimer: undefined,
  };
}

export function createRunStartAppender({ runs, input, idempotencyIndex, appendEvent }: { runs: Map<string, RunRecord>; input: CreateRunLifecycleInput; idempotencyIndex: Map<string, string>; appendEvent: ReturnType<typeof createRunEventWriter> }) {
  /** `start()`'s phase 2: appends the durable `'start'` entry, rolling back the in-memory record and idempotency-index entry on failure. */
  async function appendStartOrRollback(runId: string, record: RunRecord, startInput: StartRunInput): Promise<void> {
    const startPayload = buildStartPayload({ runId: runId, startInput: startInput });
    const startPromise = appendEvent({ runId, record, event: 'start', data: startPayload }).then(() => undefined);
    record.startPromise = startPromise;
    try {
      await startPromise;
      record.startPromise = undefined;
    } catch (error) {
      runs.delete(runId);
      input.delegatedResultCorrelation?.clearRun({ runId });
      clearIdempotencyIndexEntryIfMatching({ idempotencyIndex: idempotencyIndex, idempotencyKey: startInput.idempotencyKey, runId: runId });
      throw error;
    }
  }
  return appendStartOrRollback;
}

export function createRunRecordRehydrator({ runs, eventLog, idempotencyIndex, trackTerminalRun }: { runs: Map<string, RunRecord>; eventLog: EventLog; idempotencyIndex: Map<string, string>; trackTerminalRun: ReturnType<typeof createTerminalRunTracker> }) {
  /**
   * Restores one run into the in-memory index from its durable log. Returns what the caller must do
   * about it: `'skipped'` for a run already resident or with no usable log, otherwise whether the
   * restored run was already terminal.
   */
  async function rehydrateOne(runId: string): Promise<'skipped' | 'terminal' | 'non-terminal'> {
    if (runs.has(runId)) return 'skipped';
    const replay = await eventLog.replay({ runId: runId, afterCursor: null });
    if (replay.kind !== 'ok' || replay.entries.length === 0) return 'skipped';

    const { record, idempotencyKey, terminalAt } = rehydratedRunRecord(runId, replay.entries);
    runs.set(runId, record);
    if (idempotencyKey !== undefined) idempotencyIndex.set(idempotencyKey, runId);
    // `eventLog.listRunIds()` returns every run id the durable log has ever seen, with no bound of
    // its own — without this, a restart would re-populate `runs` with the daemon's entire terminal
    // run history on every boot, reproducing the same unbounded growth this module now guards
    // against at runtime.
    if (terminalAt === undefined) return 'non-terminal';
    trackTerminalRun(runId, record, terminalAt);
    return 'terminal';
  }
  return rehydrateOne;
}

export function createRunRehydrateMethod({ eventLog, rehydrateOne, getLifecycle }: { eventLog: EventLog; rehydrateOne: ReturnType<typeof createRunRecordRehydrator>; getLifecycle: () => RunLifecycle }): RunLifecycle["rehydrate"] {
  let hydration: Promise<void> | null = null;
  return {
    async rehydrate(_args: Record<string, never>): Promise<void> {
      if (hydration) return hydration;
      hydration = (async () => {
        const rehydratedNonTerminalRunIds: string[] = [];
        for (const runId of await eventLog.listRunIds({  })) {
          if (await rehydrateOne(runId) === 'non-terminal') {
            rehydratedNonTerminalRunIds.push(runId);
          }
        }

        // A process restart cannot retain an in-memory child process or cancellation listener.
        // Persist an honest terminal outcome instead of advertising an orphaned run as still live.
        for (const runId of rehydratedNonTerminalRunIds) {
          await getLifecycle().finish({ runId, status: 'failed', code: null, signal: null, resumable: true });
        }
      })();
      return hydration;
    },
  }.rehydrate;
}

export function createRunStartMethod({ idempotencyIndex, requireRun, runs, appendStartOrRollback, handleInactivityTimeout, slowRunThresholdMs, handleSlowRunNotice }: { idempotencyIndex: Map<string, string>; requireRun: ReturnType<typeof createRunLookup>; runs: Map<string, RunRecord>; appendStartOrRollback: ReturnType<typeof createRunStartAppender>; handleInactivityTimeout: ReturnType<typeof createInactivityTimeoutHandler>; slowRunThresholdMs: number | undefined; handleSlowRunNotice: ReturnType<typeof createSlowRunNoticeHandler> }): RunLifecycle["start"] {
  return {
    async start(requiredArgs: Pick<StartRunInput, "contextRef">, optionalArgs: Pick<StartRunInput, "agentId" | "idempotencyKey" | "runId" | "inactivityTimeoutMs"> = {}): Promise<StartRunResult> {
  const startInput: StartRunInput = { ...requiredArgs, ...optionalArgs };
      // Synchronous on purpose: `resolveIdempotentReplayRunId` does no I/O, and the common case
      // (no idempotencyKey, or a fresh one) must reach `runs.set()` below in the same synchronous
      // turn as this call — not after even one microtask tick — so a caller that races `finish()`
      // in immediately after `start()` (before ever awaiting it) still finds the record `finish()`
      // needs. Wrapping this check in its own `await`ed async function previously broke exactly
      // that: an `async function` always defers its continuation by a microtask even when its body
      // never itself awaits, which shifted `runs.set()` behind the racing `finish()` call.
      const existingRunId = resolveIdempotentReplayRunId({ idempotencyIndex: idempotencyIndex, idempotencyKey: startInput.idempotencyKey });
      if (existingRunId !== undefined) {
        const existing = requireRun(existingRunId);
        await existing.startPromise;
        return { run: toPublicStatus(existing), started: false };
      }

      const runId = startInput.runId ?? randomUUID();
      if (runs.has(runId)) {
        throw new Error(`RunLifecycle: run "${runId}" already exists`);
      }

      const record = buildNewRunRecord(startInput, runId, Date.now());
      runs.set(runId, record);
      registerIdempotencyKeyIfPresent({ idempotencyIndex: idempotencyIndex, idempotencyKey: startInput.idempotencyKey, runId: runId });

      await appendStartOrRollback(runId, record, startInput);

      armWatchdogIfConfigured({ record: record, timeoutMs: startInput.inactivityTimeoutMs, onTimeout: () => {
        void handleInactivityTimeout(runId);
      } });
      armSlowRunWatchdogIfConfigured({ record: record, timeoutMs: slowRunThresholdMs, onTimeout: () => {
        void handleSlowRunNotice(runId);
      } });

      return { run: toPublicStatus(record), started: true };
    },
  }.start;
}
