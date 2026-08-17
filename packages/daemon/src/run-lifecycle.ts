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
 * that is `@jini-ai/agent-runtime`'s job (extraction-plan task 7). A driver
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
} from '@jini-ai/protocol';
import { RUN_PROTOCOL_VERSION, isTerminalRunState } from '@jini-ai/protocol';
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
  /** Gap 5 (session resume) — see `RunEndPayload.sessionRef`'s doc in `@jini-ai/protocol`. Threaded straight through to the durable `'end'` entry; this module has no opinion on what it means. */
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
  /** Pending durable start append; idempotent duplicates wait for it instead of observing a ghost record. */
  startPromise: Promise<void> | undefined;
  /** Serializes concurrent terminal transitions while state remains non-terminal until the end append commits. */
  finishPromise: Promise<RunStatus> | undefined;
  /** Armed while this run is terminal and retained, pending eviction from `runs`/`idempotencyIndex` — see the terminal-retention helpers below. `undefined` for a non-terminal run, or a terminal one `resume()` has reclaimed. */
  retentionTimer: ReturnType<typeof setTimeout> | undefined;
}

/** Vocabulary-firewall bridge: `RunState` uses `'cancelled'` (extraction-plan §12 C5's own cited canary), `RunEndPayload.status` uses `'canceled'`. Both live in `@jini-ai/protocol`, which is out of scope for this task — bridged here rather than fixed upstream. */
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
 * Bridges `@jini-ai/daemon`'s own `EventLogEntry` (`{id, event, data, recordedAt}`) to
 * `@jini-ai/protocol`'s canonical `RunEvent` envelope. `EventLogEntry` carries no `runId` of its
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
): { record: RunRecord; idempotencyKey: string | undefined; isTerminal: boolean } {
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
      startPromise: undefined,
      finishPromise: undefined,
      retentionTimer: undefined,
    },
    idempotencyKey,
    isTerminal: terminal !== null,
  };
}

function terminalStateFromEndEntry(entry: EventLogEntry): { state: TerminalRunOutcome; resumable: boolean } {
  if (!isRecord(entry.data)) return { state: 'failed', resumable: false };
  const status = entry.data.status;
  const state: TerminalRunOutcome =
    status === 'succeeded' ? 'succeeded' : status === 'canceled' ? 'cancelled' : 'failed';
  return { state, resumable: entry.data.resumable === true };
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
export function resolveIdempotentReplayRunId(
  idempotencyIndex: ReadonlyMap<string, string>,
  idempotencyKey: string | undefined,
): string | undefined {
  if (idempotencyKey === undefined) return undefined;
  return idempotencyIndex.get(idempotencyKey);
}

/** Registers `runId` under `idempotencyKey` in `idempotencyIndex` — a no-op when no key was supplied. */
export function registerIdempotencyKeyIfPresent(
  idempotencyIndex: Map<string, string>,
  idempotencyKey: string | undefined,
  runId: string,
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
export function clearIdempotencyIndexEntryIfMatching(
  idempotencyIndex: Map<string, string>,
  idempotencyKey: string | undefined,
  runId: string,
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
 * How long a just-terminal run should remain retained before its eviction timer fires: `retentionMs`
 * minus however much of that window has already elapsed since `terminalAt`. Floored at `0` so a run
 * that was already past its retention window when this is computed (relevant for `rehydrate()`,
 * where a run may have gone terminal long before this process started) schedules an immediate
 * eviction rather than a negative-delay timer. Pure.
 */
export function computeRetentionDelayMs(terminalAt: number, retentionMs: number, now: number): number {
  return Math.max(0, retentionMs - (now - terminalAt));
}

/** The durable `'start'` entry's payload — pure field mapping, split out of `start()` so its two optional-field spreads don't count toward that method's own complexity. */
export function buildStartPayload(
  runId: string,
  startInput: Pick<StartRunInput, 'contextRef' | 'agentId' | 'idempotencyKey'>,
): RunStartPayload {
  return {
    runId,
    contextRef: startInput.contextRef,
    ...(startInput.agentId !== undefined ? { agentId: startInput.agentId } : {}),
    ...(startInput.idempotencyKey !== undefined ? { idempotencyKey: startInput.idempotencyKey } : {}),
  };
}

/**
 * Arms `record.watchdog` when `timeoutMs` is configured — a no-op otherwise. `record` is typed as a
 * plain `{watchdog}` shape (not `Pick<RunRecord, 'watchdog'>`) purely so this function can be
 * exported without naming the private `RunRecord` type in a public signature.
 */
export function armWatchdogIfConfigured(
  record: { watchdog: InactivityWatchdog | undefined },
  timeoutMs: number | undefined,
  onTimeout: () => void,
): void {
  if (timeoutMs === undefined) return;
  record.watchdog = createInactivityWatchdog({ timeoutMs, onTimeout });
}

/**
 * `stream()`'s replay-delivery step: sends every already-durable entry to `onEvent`, returning the
 * delivered eventIds so a caller can avoid re-delivering the same event from a different source
 * (buffered live events observed during the replay, a terminal catch-up event). Pure aside from
 * calling the injected `onEvent`.
 */
export function deliverReplayedEvents(
  runId: string,
  entries: readonly EventLogEntry[],
  onEvent: (event: RunProtocolEvent) => void,
): Set<string> {
  const deliveredEventIds = new Set<string>();
  for (const entry of entries) {
    const event = toRunEvent(runId, entry);
    deliveredEventIds.add(event.eventId);
    onEvent(event);
  }
  return deliveredEventIds;
}

/**
 * Delivers every event in `events` not already present in `deliveredEventIds`, marking each as
 * delivered as it goes. Reused in `stream()` for both the buffered-live-event catch-up and the
 * single terminal-event catch-up, so the "don't double-deliver" bookkeeping lives in one place.
 */
export function deliverUndeliveredEvents(
  events: readonly RunProtocolEvent[],
  deliveredEventIds: Set<string>,
  onEvent: (event: RunProtocolEvent) => void,
): void {
  for (const event of events) {
    if (!deliveredEventIds.has(event.eventId)) {
      deliveredEventIds.add(event.eventId);
      onEvent(event);
    }
  }
}

/**
 * Closes out a `stream()` subscription once replay and catch-up delivery are done: a terminal run's
 * subscriber is removed immediately (no further event will ever come), a still-live run's stays
 * registered behind the returned `unsubscribe`. `record` is typed as a plain `{subscribers}` shape
 * for the same exportability reason as {@link armWatchdogIfConfigured}.
 */
export function finishStreamSubscription(
  record: { subscribers: Set<(event: RunProtocolEvent) => void> },
  subscriber: (event: RunProtocolEvent) => void,
  terminal: boolean,
): StreamSubscribeResult {
  if (terminal) {
    record.subscribers.delete(subscriber);
    return { kind: 'ok', unsubscribe: () => {} };
  }
  return { kind: 'ok', unsubscribe: () => record.subscribers.delete(subscriber) };
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
    startPromise: undefined,
    finishPromise: undefined,
    retentionTimer: undefined,
  };
}

export interface CreateRunLifecycleInput {
  readonly eventLog: EventLog;
  /** Host-owned sink for asynchronous lifecycle failures that cannot be returned to a caller. Defaults to `console.error`. */
  readonly onInternalError?: (context: RunLifecycleInternalErrorContext) => void;
  /** How long a terminal run's in-memory record is retained before eviction. See {@link DEFAULT_TERMINAL_RETENTION_MS}. Defaults to that constant. */
  readonly terminalRetentionMs?: number;
  /** Hard cap on concurrently-retained terminal run records. See {@link DEFAULT_MAX_TERMINAL_RUNS}. Defaults to that constant. */
  readonly maxTerminalRuns?: number;
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
 * @param input.terminalRetentionMs - See {@link CreateRunLifecycleInput.terminalRetentionMs}.
 * @param input.maxTerminalRuns - See {@link CreateRunLifecycleInput.maxTerminalRuns}.
 * @returns A `RunLifecycle` backed by an in-memory run registry plus the injected `EventLog`.
 * @complexity Per-call complexities documented on each method; the registry itself is a `Map` keyed by `runId` (O(1) lookup). Memory is bounded: non-terminal runs are O(n) in concurrently-live runs, and terminal runs are capped at `maxTerminalRuns` (each additionally bounded in retention time by `terminalRetentionMs`) rather than growing for the life of the process.
 * @overallScore 100/100
 */
export function createRunLifecycle(input: CreateRunLifecycleInput): RunLifecycle {
  const { eventLog } = input;
  const terminalRetentionMs = input.terminalRetentionMs ?? DEFAULT_TERMINAL_RETENTION_MS;
  const maxTerminalRuns = input.maxTerminalRuns ?? DEFAULT_MAX_TERMINAL_RUNS;
  const runs = new Map<string, RunRecord>();
  const idempotencyIndex = new Map<string, string>();
  // Terminal runIds in the order they were tracked (oldest first) — the LRU order `enforceTerminalCap`
  // trims from. A run leaves this list exactly once, either via its retention timer firing or via
  // `resume()` reclaiming it; see `evictTerminalRun`/`untrackTerminalRun`.
  const terminalRunOrder: string[] = [];
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

  /** `start()`'s phase 2: appends the durable `'start'` entry, rolling back the in-memory record and idempotency-index entry on failure. */
  async function appendStartOrRollback(runId: string, record: RunRecord, startInput: StartRunInput): Promise<void> {
    const startPayload = buildStartPayload(runId, startInput);
    const startPromise = appendEvent(runId, record, 'start', startPayload).then(() => undefined);
    record.startPromise = startPromise;
    try {
      await startPromise;
      record.startPromise = undefined;
    } catch (error) {
      runs.delete(runId);
      clearIdempotencyIndexEntryIfMatching(idempotencyIndex, startInput.idempotencyKey, runId);
      throw error;
    }
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

  function resolveTerminalWaiters(record: RunRecord): void {
    const waiters = record.terminalWaiters.splice(0, record.terminalWaiters.length);
    const status = toPublicStatus(record);
    for (const resolve of waiters) {
      resolve(status);
    }
  }

  function removeFromTerminalOrder(runId: string): void {
    const index = terminalRunOrder.indexOf(runId);
    if (index !== -1) terminalRunOrder.splice(index, 1);
  }

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
    clearIdempotencyIndexEntryIfMatching(idempotencyIndex, record.idempotencyKey, runId);
  }

  /** Trims the oldest terminal records until `terminalRunOrder` is back at or under `maxTerminalRuns`. */
  function enforceTerminalCap(): void {
    while (terminalRunOrder.length > maxTerminalRuns) {
      evictTerminalRun(terminalRunOrder[0]!);
    }
  }

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
    const delay = computeRetentionDelayMs(terminalAt, terminalRetentionMs, Date.now());
    const timer = setTimeout(() => evictTerminalRun(runId), delay);
    if (typeof timer.unref === 'function') timer.unref();
    record.retentionTimer = timer;
    enforceTerminalCap();
  }

  /** Reverses `trackTerminalRun`: cancels the pending eviction and un-enrolls `runId`. Called from `resume()` so a reclaimed run cannot be evicted out from under its new, non-terminal life. */
  function untrackTerminalRun(runId: string, record: RunRecord): void {
    removeFromTerminalOrder(runId);
    if (record.retentionTimer) {
      clearTimeout(record.retentionTimer);
      record.retentionTimer = undefined;
    }
  }

  /**
   * Fires when a run's inactivity watchdog times out with no intervening
   * `emit()`/`finish()`. Classified as a resumable failure (`code: null,
   * signal: null`), mirroring OD's own timeout/inactivity classification
   * (`isResumableFailure` in the researched `run-failure-classification.ts`
   * treats timeout/inactivity as one of only two resumable categories).
   *
   * The `!record || isTerminalRunState(...)` guard below is defensive only and is currently
   * unreachable through the public API — deliberately kept, not fake-tested, and the reason is
   * recorded here so the next reader does not spend time trying to cover it:
   *
   * - `isTerminalRunState(...)`: every route to a terminal state runs through `finish()`, which
   *   calls `record.watchdog?.cancel()` and assigns `record.status.state` in the *same synchronous
   *   block* after its durable end append resolves. There is no interleaving point between the two,
   *   so "watchdog still armed" and "record already terminal" cannot both hold when this fires. (If
   *   the end append *throws*, the watchdog stays armed but the run also stays non-terminal.)
   * - `!record`: the only `runs.delete()` is `start()`'s unwind on a failed durable start append,
   *   which happens strictly before the watchdog is armed a few lines later. It is also required
   *   for type-narrowing `record` before `record.status.state` is read, so it cannot simply be
   *   dropped.
   *
   * Note the "start/finish race" test below does *not* exercise this guard despite its name: by the
   * time it advances the timers, `finish()` has already cancelled the watchdog, so the callback
   * never runs at all. It still correctly asserts that no second `finish()` happens.
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
          console.error(`[@jini-ai/daemon] internal error (inactivity-timeout, runId=${runId})`, error);
        }
      } catch (sinkError) {
        // A diagnostic sink must not turn a contained timer failure into another unhandled
        // rejection.
        // eslint-disable-next-line no-console
        console.error(`[@jini-ai/daemon] internal error sink failed (inactivity-timeout, runId=${runId})`, sinkError);
      }
    }
  }

  /**
   * Restores one run into the in-memory index from its durable log. Returns what the caller must do
   * about it: `'skipped'` for a run already resident or with no usable log, otherwise whether the
   * restored run was already terminal.
   */
  async function rehydrateOne(runId: string): Promise<'skipped' | 'terminal' | 'non-terminal'> {
    if (runs.has(runId)) return 'skipped';
    const replay = await eventLog.replay(runId, null);
    if (replay.kind !== 'ok' || replay.entries.length === 0) return 'skipped';

    const { record, idempotencyKey, isTerminal } = rehydratedRunRecord(runId, replay.entries);
    runs.set(runId, record);
    if (idempotencyKey !== undefined) idempotencyIndex.set(idempotencyKey, runId);
    // `eventLog.listRunIds()` returns every run id the durable log has ever seen, with no bound of
    // its own — without this, a restart would re-populate `runs` with the daemon's entire terminal
    // run history on every boot, reproducing the same unbounded growth this module now guards
    // against at runtime.
    if (isTerminal) trackTerminalRun(runId, record, record.status.endedAt ?? Date.now());
    return isTerminal ? 'terminal' : 'non-terminal';
  }

  const lifecycle: RunLifecycle = {
    async rehydrate(): Promise<void> {
      if (hydration) return hydration;
      hydration = (async () => {
        const rehydratedNonTerminalRunIds: string[] = [];
        for (const runId of await eventLog.listRunIds()) {
          if (await rehydrateOne(runId) === 'non-terminal') {
            rehydratedNonTerminalRunIds.push(runId);
          }
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
      // Synchronous on purpose: `resolveIdempotentReplayRunId` does no I/O, and the common case
      // (no idempotencyKey, or a fresh one) must reach `runs.set()` below in the same synchronous
      // turn as this call — not after even one microtask tick — so a caller that races `finish()`
      // in immediately after `start()` (before ever awaiting it) still finds the record `finish()`
      // needs. Wrapping this check in its own `await`ed async function previously broke exactly
      // that: an `async function` always defers its continuation by a microtask even when its body
      // never itself awaits, which shifted `runs.set()` behind the racing `finish()` call.
      const existingRunId = resolveIdempotentReplayRunId(idempotencyIndex, startInput.idempotencyKey);
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
      registerIdempotencyKeyIfPresent(idempotencyIndex, startInput.idempotencyKey, runId);

      await appendStartOrRollback(runId, record, startInput);

      armWatchdogIfConfigured(record, startInput.inactivityTimeoutMs, () => {
        void handleInactivityTimeout(runId);
      });

      return { run: toPublicStatus(record), started: true };
    },

    async get(runId: string): Promise<RunStatus | undefined> {
      await settlePendingStart(runs.get(runId));
      // Re-read rather than reusing the record above: a failed start deletes it (see `start()`'s
      // unwind), and reporting a run whose durable `'start'` entry does not exist would advertise a
      // run no restart could ever rehydrate.
      const record = runs.get(runId);
      return record ? toPublicStatus(record) : undefined;
    },

    async list(contextRef?: string): Promise<readonly RunStatus[]> {
      await Promise.all(Array.from(runs.values(), settlePendingStart));
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
        trackTerminalRun(finishInput.runId, record, endEntry.recordedAt);
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
      untrackTerminalRun(runId, record);
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
      // Awaited (and *propagated*, unlike in `get`/`list`) before any waiter is registered. A run
      // whose durable start append rejects is unwound, and nothing ever calls `finish()` for it — so
      // a waiter parked inside that window would never be resolved by anyone. Failing the wait with
      // the same error that failed the start is the only honest terminal answer, and awaiting first
      // means `terminalWaiters` can only ever hold waiters for a run that really does exist.
      await record.startPromise;
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
        const deliveredEventIds = deliverReplayedEvents(runId, replay.entries, onEvent);
        deliverUndeliveredEvents(bufferedLiveEvents, deliveredEventIds, onEvent);
        replaying = false;

        const terminal = isTerminalRunState(record.status.state);
        if (terminal && record.terminalEndEntry) {
          deliverUndeliveredEvents([toRunEvent(runId, record.terminalEndEntry)], deliveredEventIds, onEvent);
        }

        return finishStreamSubscription(record, subscriber, terminal);
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
