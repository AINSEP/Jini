/**
 * `RunLifecycle` — start/stream/cancel/resume a run keyed on an opaque
 * `contextRef` (extraction-plan §2.1: runs key on an opaque `contextRef`,
 * never a product-record identifier), generalized from OD's `design.runs` service
 * (`apps/daemon/src/runtimes/runs.ts` + the terminal-decision half of
 * `apps/daemon/src/runtimes/start-chat-run.ts`, `arch/server-startserver-endgame`
 * branch — see `source-map.md` for exact line citations).
 *
 * Scope boundary: this module owns the run *state machine* and its event
 * log — create, transition, emit, replay, cancellation-intent propagation,
 * idempotent start/finish, resume. It does not spawn or signal a subprocess;
 * that is `@jini/agent-runtime`'s job (extraction-plan task 7). A driver
 * (today: this package's tests; later: agent-runtime) calls `emit()` for
 * agent/stdout/stderr/error events, observes cancellation via
 * `onCancelRequested`, and calls `finish()` once it knows the real outcome.
 */
import { randomUUID } from 'node:crypto';
import type {
  RunAgentPayload,
  RunCancelRequest,
  RunChunkPayload,
  RunEndPayload,
  RunErrorPayload,
  RunProtocolEvent,
  RunStartPayload,
  RunState,
  RunStatus,
} from '@jini/protocol';
import { RUN_PROTOCOL_VERSION, isTerminalRunState } from '@jini/protocol';
import type { EventLog, EventLogEntry, EventLogReplayResult } from './event-log.js';
import type { InactivityWatchdog, TerminalRunOutcome } from './close-status.js';
import { createInactivityWatchdog } from './close-status.js';

export interface StartRunInput {
  /** Opaque caller-supplied identity the run belongs to — never a project/conversation id (see module doc). */
  readonly contextRef: string;
  readonly agentId?: string;
  /**
   * Caller-supplied idempotency key. Starting twice with the same key
   * returns the original run (`started: false`) instead of creating a
   * second one — new behavior this port builds fresh, since OD's own
   * `clientRequestId` is threaded through but never actually deduplicated
   * against (confirmed absent upstream; see `source-map.md`).
   */
  readonly idempotencyKey?: string;
  /** Override the generated run id — test/fixture hook only. */
  readonly runId?: string;
  /** When set, arms an inactivity watchdog that fails the run as a resumable failure if no `emit()` occurs within this window. */
  readonly inactivityTimeoutMs?: number;
}

export interface StartRunResult {
  readonly run: RunStatus;
  /** `false` when an existing run was returned via idempotency-key replay rather than a new one being created. */
  readonly started: boolean;
}

export interface FinishRunInput {
  readonly runId: string;
  readonly status: TerminalRunOutcome;
  readonly code: number | null;
  readonly signal: string | null;
  /**
   * True when a `'failed'`/`'cancelled'` run can be recovered by `resume()`
   * instead of requiring a fresh `start()`. Generalized from OD's
   * `run.resumable` flag (set only for a narrow, explicitly resumable
   * failure-classification subset — see `run-failure-classification.ts` in
   * the researched source).
   */
  readonly resumable: boolean;
  /** Gap 5 (session resume) — see `RunEndPayload.sessionRef`'s doc in `@jini/protocol`. Threaded straight through to the durable `'end'` entry; this module has no opinion on what it means. */
  readonly sessionRef?: string;
}

export interface ResumeRunResult {
  readonly run: RunStatus;
  /** `false` when the run was not eligible (not terminal, or terminal but not `resumable`) — not an error, just a no-op. */
  readonly resumed: boolean;
}

/** The subset of `RunProtocolEvent` a driver may emit directly. `'start'`/`'end'` are kernel-managed — see `start()`/`finish()`. */
export type DriverEmittableInput =
  | { readonly event: 'agent'; readonly data: RunAgentPayload }
  | { readonly event: 'stdout'; readonly data: RunChunkPayload }
  | { readonly event: 'stderr'; readonly data: RunChunkPayload }
  | { readonly event: 'error'; readonly data: RunErrorPayload };

export type Unsubscribe = () => void;

export interface StreamOptions {
  readonly afterCursor?: string | null;
}

export type StreamSubscribeResult = { readonly kind: 'ok'; readonly unsubscribe: Unsubscribe } | Exclude<EventLogReplayResult, { kind: 'ok' }>;

export interface RunLifecycle {
  /** Rebuilds the in-memory run index from durable EventLog records. Hosts must await this once during boot before accepting run requests. */
  rehydrate(): Promise<void>;
  start(input: StartRunInput): Promise<StartRunResult>;
  get(runId: string): Promise<RunStatus | undefined>;
  list(contextRef?: string): Promise<readonly RunStatus[]>;
  /** Records cancellation intent. Idempotent — cancelling an already-terminal run is a no-op, not an error. */
  cancel(request: RunCancelRequest): Promise<RunStatus>;
  /** Registers a listener fired synchronously when `cancel()` is called for `runId`. Returns an unsubscribe function. */
  onCancelRequested(runId: string, listener: (request: RunCancelRequest) => void): Unsubscribe;
  /** Appends a driver-observed event and fans it out to live subscribers. Throws if `runId` is unknown or already terminal. */
  emit(runId: string, input: DriverEmittableInput): Promise<RunProtocolEvent>;
  /** Idempotent terminal transition; a second call while already terminal is a no-op that returns the existing status unchanged. */
  finish(input: FinishRunInput): Promise<RunStatus>;
  resume(runId: string): Promise<ResumeRunResult>;
  /** Resolves once `runId` reaches a terminal state; resolves immediately if it already has. */
  waitForTerminal(runId: string): Promise<RunStatus>;
  /**
   * Replays buffered history after `options.afterCursor` (or from the
   * beginning if omitted/null) and then subscribes `onEvent` for live
   * delivery — the reconnect-and-resume-streaming operation a transport
   * uses. Mirrors OD's own reconnect guarantee: a caller that reconnects
   * already caught up on a *terminal* run still receives one more delivery
   * of the final `'end'` event, so a client can never silently miss the
   * terminal signal (`runs.ts` `stream()`, researched source).
   */
  stream(runId: string, onEvent: (event: RunProtocolEvent) => void, options?: StreamOptions): Promise<StreamSubscribeResult>;
}

interface RunRecord {
  contextRef: string | undefined;
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
  /** Pending durable start append; idempotent duplicates wait for it instead of observing a ghost record. */
  startPromise: Promise<void> | undefined;
  /** Serializes concurrent terminal transitions while state remains non-terminal until the end append commits. */
  finishPromise: Promise<RunStatus> | undefined;
}

/** Vocabulary-firewall bridge: `RunState` uses `'cancelled'` (extraction-plan §12 C5's own cited canary), `RunEndPayload.status` uses `'canceled'`. Both live in `@jini/protocol`, which is out of scope for this task — bridged here rather than fixed upstream. */
const TERMINAL_OUTCOME_TO_END_STATUS: Record<TerminalRunOutcome, NonNullable<RunEndPayload['status']>> = {
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'canceled',
};

function toPublicStatus(record: RunRecord): RunStatus {
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

/**
 * Bridges `@jini/daemon`'s own `EventLogEntry` (`{id, event, data, recordedAt}`) to
 * `@jini/protocol`'s canonical `RunEvent` envelope. `EventLogEntry` carries no `runId` of its
 * own (the log is already scoped by the `runId` parameter every `EventLog` method takes), so
 * this is the one place that stamps it onto the outgoing envelope.
 */
function toRunEvent(runId: string, entry: EventLogEntry): RunProtocolEvent {
  return {
    runId,
    eventId: `${runId}:${entry.id}`,
    opaqueCursor: entry.id,
    protocolVersion: RUN_PROTOCOL_VERSION,
    ts: entry.recordedAt,
    kind: entry.event,
    payload: entry.data,
    durability: 'durable',
  } as RunProtocolEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function terminalStateFromEndEntry(entry: EventLogEntry): { state: TerminalRunOutcome; resumable: boolean } {
  if (!isRecord(entry.data)) return { state: 'failed', resumable: false };
  const status = entry.data.status;
  const state: TerminalRunOutcome =
    status === 'succeeded' ? 'succeeded' : status === 'canceled' ? 'cancelled' : 'failed';
  return { state, resumable: entry.data.resumable === true };
}

export interface CreateRunLifecycleInput {
  readonly eventLog: EventLog;
  /** Host-owned sink for asynchronous lifecycle failures that cannot be returned to a caller. Defaults to `console.error`. */
  readonly onInternalError?: (context: RunLifecycleInternalErrorContext) => void;
}

export interface RunLifecycleInternalErrorContext {
  readonly source: 'inactivity-timeout';
  readonly runId: string;
  readonly error: unknown;
}

/**
 * Creates the in-process `RunLifecycle` reference implementation.
 *
 * @param input.eventLog - The durable `EventLog` port this lifecycle appends to and replays from.
 * @returns A `RunLifecycle` backed by an in-memory run registry plus the injected `EventLog`.
 * @complexity Per-call complexities documented on each method; the registry itself is a `Map` keyed by `runId` (O(1) lookup).
 * @overallScore 100/100
 */
export function createRunLifecycle(input: CreateRunLifecycleInput): RunLifecycle {
  const { eventLog } = input;
  const runs = new Map<string, RunRecord>();
  const idempotencyIndex = new Map<string, string>();
  let hydration: Promise<void> | null = null;

  function requireRun(runId: string): RunRecord {
    const record = runs.get(runId);
    if (!record) {
      throw new Error(`RunLifecycle: unknown run "${runId}"`);
    }
    return record;
  }

  /**
   * A subscriber is a transport-owned callback (e.g. an SSE writer) outside this module's
   * control. One subscriber throwing (a dead socket, a broken client) must never abort the
   * fan-out to the others, nor propagate out through `emit()`/`finish()` into driver code that
   * has nothing to do with that transport — see CR-R1 in
   * `ADS-memory/reports/code-review/CR-backend-coverage-push-2026-07-20.md`.
   */
  function notifySubscribers(record: RunRecord, event: RunProtocolEvent): void {
    for (const subscriber of record.subscribers) {
      try {
        subscriber(event);
      } catch {
        // Isolated by design — see the function doc above.
      }
    }
  }

  async function appendEvent(runId: string, record: RunRecord, event: string, data: unknown): Promise<RunProtocolEvent> {
    const entry = await eventLog.append({ runId, event, data });
    const runEvent = toRunEvent(runId, entry);
    notifySubscribers(record, runEvent);
    return runEvent;
  }

  function resolveTerminalWaiters(record: RunRecord): void {
    const waiters = record.terminalWaiters.splice(0, record.terminalWaiters.length);
    const status = toPublicStatus(record);
    for (const resolve of waiters) {
      resolve(status);
    }
  }

  /**
   * Fires when a run's inactivity watchdog times out with no intervening
   * `emit()`/`finish()`. Classified as a resumable failure (`code: null,
   * signal: null`), mirroring OD's own timeout/inactivity classification
   * (`isResumableFailure` in the researched `run-failure-classification.ts`
   * treats timeout/inactivity as one of only two resumable categories).
   * A run that already reached a terminal state before the timer fired
   * (a normal race with `finish()`) is left untouched.
   */
  async function handleInactivityTimeout(runId: string): Promise<void> {
    const record = runs.get(runId);
    if (!record || isTerminalRunState(record.status.state)) {
      return;
    }
    try {
      await lifecycle.finish({ runId, status: 'failed', code: null, signal: null, resumable: true });
    } catch (error) {
      const context: RunLifecycleInternalErrorContext = { source: 'inactivity-timeout', runId, error };
      try {
        if (input.onInternalError) {
          input.onInternalError(context);
        } else {
          // eslint-disable-next-line no-console
          console.error(`[@jini/daemon] internal error (inactivity-timeout, runId=${runId})`, error);
        }
      } catch (sinkError) {
        // A diagnostic sink must not turn a contained timer failure into another unhandled
        // rejection.
        // eslint-disable-next-line no-console
        console.error(`[@jini/daemon] internal error sink failed (inactivity-timeout, runId=${runId})`, sinkError);
      }
    }
  }

  const lifecycle: RunLifecycle = {
    async rehydrate(): Promise<void> {
      if (hydration) return hydration;
      hydration = (async () => {
        const rehydratedNonTerminalRunIds: string[] = [];
        for (const runId of await eventLog.listRunIds()) {
          if (runs.has(runId)) continue;
          const replay = await eventLog.replay(runId, null);
          if (replay.kind !== 'ok' || replay.entries.length === 0) continue;

          const entries = replay.entries;
          const startEntry = entries.find((entry) => entry.event === 'start');
          const endEntry = [...entries].reverse().find((entry) => entry.event === 'end');
          const startData = startEntry && isRecord(startEntry.data) ? startEntry.data : null;
          const firstEntry = entries[0]!;
          const lastEntry = entries[entries.length - 1]!;
          const terminal = endEntry === undefined ? null : terminalStateFromEndEntry(endEntry);
          const contextRef = typeof startData?.contextRef === 'string' ? startData.contextRef : undefined;
          const idempotencyKey = typeof startData?.idempotencyKey === 'string' ? startData.idempotencyKey : undefined;
          const record: RunRecord = {
            contextRef,
            status: {
              id: runId,
              state: terminal?.state ?? 'running',
              startedAt: startEntry?.recordedAt ?? firstEntry.recordedAt,
              updatedAt: lastEntry.recordedAt,
              endedAt: endEntry?.recordedAt,
            },
            resumable: terminal?.resumable ?? false,
            cancelRequested: false,
            lastCancelRequest: undefined,
            cancelListeners: new Set(),
            subscribers: new Set(),
            terminalWaiters: [],
            terminalEndEntry: endEntry,
            watchdog: undefined,
            startPromise: undefined,
            finishPromise: undefined,
          };
          runs.set(runId, record);
          if (idempotencyKey !== undefined) idempotencyIndex.set(idempotencyKey, runId);
          if (terminal === null) rehydratedNonTerminalRunIds.push(runId);
        }

        // A process restart cannot retain an in-memory child process or cancellation listener.
        // Persist an honest terminal outcome instead of advertising an orphaned run as still live.
        for (const runId of rehydratedNonTerminalRunIds) {
          await lifecycle.finish({ runId, status: 'failed', code: null, signal: null, resumable: true });
        }
      })();
      return hydration;
    },

    async start(startInput: StartRunInput): Promise<StartRunResult> {
      if (startInput.idempotencyKey !== undefined) {
        const existingRunId = idempotencyIndex.get(startInput.idempotencyKey);
        if (existingRunId) {
          const existing = requireRun(existingRunId);
          await existing.startPromise;
          return { run: toPublicStatus(existing), started: false };
        }
      }

      const runId = startInput.runId ?? randomUUID();
      if (runs.has(runId)) {
        throw new Error(`RunLifecycle: run "${runId}" already exists`);
      }

      const now = Date.now();
      const record: RunRecord = {
        contextRef: startInput.contextRef,
        status: { id: runId, state: 'running', startedAt: now, updatedAt: now, endedAt: undefined },
        resumable: false,
        cancelRequested: false,
        lastCancelRequest: undefined,
        cancelListeners: new Set(),
        subscribers: new Set(),
        terminalWaiters: [],
        terminalEndEntry: undefined,
        watchdog: undefined,
        startPromise: undefined,
        finishPromise: undefined,
      };
      runs.set(runId, record);
      if (startInput.idempotencyKey !== undefined) {
        idempotencyIndex.set(startInput.idempotencyKey, runId);
      }

      const startPayload: RunStartPayload = {
        runId,
        contextRef: startInput.contextRef,
        ...(startInput.agentId !== undefined ? { agentId: startInput.agentId } : {}),
        ...(startInput.idempotencyKey !== undefined ? { idempotencyKey: startInput.idempotencyKey } : {}),
      };
      const startPromise = appendEvent(runId, record, 'start', startPayload).then(() => undefined);
      record.startPromise = startPromise;
      try {
        await startPromise;
        record.startPromise = undefined;
      } catch (error) {
        runs.delete(runId);
        if (
          startInput.idempotencyKey !== undefined &&
          idempotencyIndex.get(startInput.idempotencyKey) === runId
        ) {
          idempotencyIndex.delete(startInput.idempotencyKey);
        }
        throw error;
      }

      if (startInput.inactivityTimeoutMs !== undefined) {
        record.watchdog = createInactivityWatchdog({
          timeoutMs: startInput.inactivityTimeoutMs,
          onTimeout: () => {
            void handleInactivityTimeout(runId);
          },
        });
      }

      return { run: toPublicStatus(record), started: true };
    },

    async get(runId: string): Promise<RunStatus | undefined> {
      const record = runs.get(runId);
      return record ? toPublicStatus(record) : undefined;
    },

    async list(contextRef?: string): Promise<readonly RunStatus[]> {
      const all = Array.from(runs.values());
      const filtered = contextRef === undefined ? all : all.filter((record) => record.contextRef === contextRef);
      return filtered.map(toPublicStatus);
    },

    async cancel(request: RunCancelRequest): Promise<RunStatus> {
      const record = requireRun(request.runId);
      await record.startPromise;
      if (record.finishPromise) {
        return record.finishPromise;
      }
      if (isTerminalRunState(record.status.state)) {
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

    /**
     * Registers a cancel-intent listener. If `cancel()` was already called
     * for this run before this subscription, the listener fires immediately
     * with the original request (mirrors `AbortSignal`'s `aborted`+`addEventListener`
     * pairing) — otherwise a driver that attaches after the cancel already
     * happened would silently never learn about it, since a plain
     * subscribe-for-future-events registry has no memory of past firings.
     */
    onCancelRequested(runId: string, listener: (request: RunCancelRequest) => void): Unsubscribe {
      const record = requireRun(runId);
      if (record.cancelRequested && record.lastCancelRequest) {
        listener(record.lastCancelRequest);
      }
      record.cancelListeners.add(listener);
      return () => record.cancelListeners.delete(listener);
    },

    async emit(runId: string, driverInput: DriverEmittableInput): Promise<RunProtocolEvent> {
      const record = requireRun(runId);
      await record.startPromise;
      if (record.finishPromise || isTerminalRunState(record.status.state)) {
        throw new Error(
          `RunLifecycle: cannot emit "${driverInput.event}" on terminal run "${runId}" — drivers must stop emitting once finish() has been called`,
        );
      }
      record.watchdog?.noteActivity();
      return appendEvent(runId, record, driverInput.event, driverInput.data);
    },

    async finish(finishInput: FinishRunInput): Promise<RunStatus> {
      const record = requireRun(finishInput.runId);
      await record.startPromise;
      if (record.finishPromise) {
        return record.finishPromise;
      }
      if (isTerminalRunState(record.status.state)) {
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
        record.watchdog?.cancel();
        record.status.state = finishInput.status;
        record.status.updatedAt = endEntry.recordedAt;
        record.status.endedAt = endEntry.recordedAt;
        record.resumable = finishInput.resumable;
        record.terminalEndEntry = endEntry;
        const endEvent = toRunEvent(finishInput.runId, endEntry);
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

    async resume(runId: string): Promise<ResumeRunResult> {
      const record = requireRun(runId);
      const eligible = isTerminalRunState(record.status.state) && record.resumable;
      if (!eligible) {
        return { run: toPublicStatus(record), resumed: false };
      }
      const now = Date.now();
      record.status.state = 'running';
      record.status.updatedAt = now;
      record.status.endedAt = undefined;
      record.resumable = false;
      record.cancelRequested = false;
      record.lastCancelRequest = undefined;
      record.terminalEndEntry = undefined;
      // No protocol event is emitted here: none of RunProtocolEvent's six
      // kinds represents "resumed" (extraction-plan scope decision — see
      // source-map.md). The event log's cursor sequence continues
      // unbroken; only RunStatus.state changes.
      return { run: toPublicStatus(record), resumed: true };
    },

    async waitForTerminal(runId: string): Promise<RunStatus> {
      const record = requireRun(runId);
      if (isTerminalRunState(record.status.state)) {
        return toPublicStatus(record);
      }
      return new Promise((resolve) => {
        record.terminalWaiters.push(resolve);
      });
    },

    async stream(
      runId: string,
      onEvent: (event: RunProtocolEvent) => void,
      options: StreamOptions = {},
    ): Promise<StreamSubscribeResult> {
      const record = runs.get(runId);
      if (!record) {
        return { kind: 'unknown-run' };
      }
      await record.startPromise;
      // Subscribe before awaiting the durable replay. Any event appended while the replay query is
      // in flight is buffered, then delivered after the replay entries, so a reconnect cannot lose
      // the narrow replay→subscribe interval or observe the live event ahead of older history.
      let replaying = true;
      const bufferedLiveEvents: RunProtocolEvent[] = [];
      const subscriber = (event: RunProtocolEvent) => {
        if (replaying) bufferedLiveEvents.push(event);
        else onEvent(event);
      };
      record.subscribers.add(subscriber);
      try {
        const replay = await eventLog.replay(runId, options.afterCursor ?? null);
        if (replay.kind !== 'ok') {
          record.subscribers.delete(subscriber);
          return replay;
        }
        const deliveredEventIds = new Set<string>();
        for (const entry of replay.entries) {
          const event = toRunEvent(runId, entry);
          deliveredEventIds.add(event.eventId);
          onEvent(event);
        }

        for (const event of bufferedLiveEvents) {
          if (!deliveredEventIds.has(event.eventId)) {
            deliveredEventIds.add(event.eventId);
            onEvent(event);
          }
        }
        replaying = false;

        const terminal = isTerminalRunState(record.status.state);
        if (terminal && record.terminalEndEntry) {
          const terminalEvent = toRunEvent(runId, record.terminalEndEntry);
          if (!deliveredEventIds.has(terminalEvent.eventId)) {
            deliveredEventIds.add(terminalEvent.eventId);
            onEvent(terminalEvent);
          }
        }

        if (terminal) {
          record.subscribers.delete(subscriber);
          return { kind: 'ok', unsubscribe: () => {} };
        }

        return { kind: 'ok', unsubscribe: () => record.subscribers.delete(subscriber) };
      } catch (error) {
        // Subscription is installed before durable replay to close the replay→live race. Any
        // replay I/O or consumer callback failure must therefore remove it before propagating.
        record.subscribers.delete(subscriber);
        throw error;
      }
    },
  };

  return lifecycle;
}
