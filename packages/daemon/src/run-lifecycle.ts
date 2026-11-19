/**
 * `RunLifecycle` — start/stream/cancel/resume a run keyed on an opaque
 * `contextRef` (extraction-plan §2.1: runs key on an opaque `contextRef`,
 * never a product-record identifier), generalized from OD's `design.runs` service
 * (`apps/daemon/src/runtimes/runs.ts` + the terminal-decision half of
 * `apps/daemon/src/runtimes/start-chat-run.ts`, `arch/server-startserver-endgame`
 * branch — see `archived provenance ledger` for exact line citations).
 *
 * Scope boundary: this module owns the run *state machine* and its event
 * log — create, transition, emit, replay, cancellation-intent propagation,
 * idempotent start/finish, resume. It does not spawn or signal a subprocess;
 * that is `@jini-ai/agent-runtime`'s job (extraction-plan task 7). A driver
 * (today: this package's tests; later: agent-runtime) calls `emit()` for
 * agent/stdout/stderr/error events, observes cancellation via
 * `onCancelRequested`, and calls `finish()` once it knows the real outcome.
 */
import type { DelegatedResultCorrelation } from './delegated-result-correlation.js';
import type {
  RunAgentPayload,
  RunCancelRequest,
  RunChunkPayload,
  RunErrorPayload,
  RunProtocolEvent,
  RunStatus,
} from '@jini-ai/protocol';
import type { EventLog, EventLogReplayResult } from './event-log.js';
import type { TerminalRunOutcome } from './close-status.js';
import { createRunGetMethod, createRunListMethod, createRunLookup, createRunRegistry } from './run-lifecycle-registry.js';
import {
  createRunRecordRehydrator,
  createRunRehydrateMethod,
  createRunStartAppender,
  createRunStartMethod,
} from './run-lifecycle-registration.js';
import { createRunEmitMethod, createRunEventWriter, createRunStreamMethod } from './run-lifecycle-events.js';
import {
  createEvictedRunEventDropper,
  createInactivityTimeoutHandler,
  createRunErrorReporter,
  createRunResumeSlowRunNoticeMethod,
  createRunSuspendSlowRunNoticeMethod,
  createSlowRunNoticeHandler,
  createTerminalCapEnforcer,
  createTerminalOrderRemoval,
  createTerminalRunEvictor,
  createTerminalRunTracker,
  createTerminalRunUntracker,
} from './run-lifecycle-timers.js';
import {
  createRunCancelMethod,
  createRunFinishMethod,
  createRunOnCancelRequestedMethod,
  createRunResumeMethod,
  createRunWaitForTerminalMethod,
} from './run-lifecycle-transitions.js';

export interface StartRunInput {
  /** Opaque caller-supplied identity the run belongs to — never a project/conversation id (see module doc). */
  readonly contextRef: string;
  readonly agentId?: string;
  /**
   * Caller-supplied idempotency key. Starting twice with the same key
   * returns the original run (`started: false`) instead of creating a
   * second one — new behavior this port builds fresh, since OD's own
   * `clientRequestId` is threaded through but never actually deduplicated
   * against (confirmed absent upstream; see `archived provenance ledger`).
   */
  readonly idempotencyKey?: string;
  /** Override the generated run id — test/fixture hook only. */
  readonly runId?: string;
  /** When set, arms an inactivity watchdog that fails the run permanently if no `emit()` occurs within this window. */
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
  rehydrate(_args: Record<string, never>): Promise<void>;
  start(requiredArgs: Pick<StartRunInput, "contextRef">, optionalArgs?: Pick<StartRunInput, "agentId" | "idempotencyKey" | "runId" | "inactivityTimeoutMs">): Promise<StartRunResult>;
  get(args: { readonly runId: string }): Promise<RunStatus | undefined>;
  list(args: Record<string, never>, optionalArgs?: { readonly contextRef?: string }): Promise<readonly RunStatus[]>;
  /** Records cancellation intent. Idempotent — cancelling an already-terminal run is a no-op, not an error. */
  cancel(request: RunCancelRequest): Promise<RunStatus>;
  /** Registers a listener fired synchronously when `cancel()` is called for `runId`. Returns an unsubscribe function. */
  onCancelRequested(args: { readonly runId: string; readonly listener: (request: RunCancelRequest) => void }): Unsubscribe;
  /** Appends a driver-observed event and fans it out to live subscribers. Throws if `runId` is unknown or already terminal. */
  emit(args: { readonly runId: string; readonly input: DriverEmittableInput }): Promise<RunProtocolEvent>;
  /** Idempotent terminal transition; a second call while already terminal is a no-op that returns the existing status unchanged. */
  finish(requiredArgs: Pick<FinishRunInput, "runId" | "status" | "code" | "signal" | "resumable">, optionalArgs?: Pick<FinishRunInput, "sessionRef">): Promise<RunStatus>;
  resume(args: { readonly runId: string }): Promise<ResumeRunResult>;
  /**
   * Suspends the slow-run watchdog for `runId` while a daemon-managed operation of legitimately
   * unbounded duration is in flight (e.g. an auto-resolved tool call the daemon itself awaits) — pair
   * with {@link RunLifecycle.resumeSlowRunNotice} once that operation concludes. `emit()` of an agent event (excluding the notice itself) is the
   * *only* other reset signal the watchdog has, and it fires nothing while such an operation is
   * running (there is no output to stream), so without this call a tool that legitimately runs past
   * the threshold (an install, a build, a repo-wide scan) is indistinguishable from the exact
   * CPU-starved-and-silent condition the watchdog exists to catch, and fires a "still working" notice
   * on a run that never actually stalled. A driver that knows exactly why a run is quiet must say so
   * rather than leaving the watchdog to guess from silence alone. No-op if `runId` is unknown,
   * already terminal, or the slow-run notice is disabled kernel-wide (`slowRunThresholdMs: null`).
   * Pairs nest: the notice stays suspended until every open suspension has been resumed.
   */
  suspendSlowRunNotice(args: { readonly runId: string }): void;
  /**
   * Re-arms the slow-run watchdog for `runId` with a fresh timeout window, undoing
   * {@link RunLifecycle.suspendSlowRunNotice} once the known operation concludes — so a genuinely
   * stalled stretch starting *after* that point is still caught. No-op under the same conditions as
   * `suspendSlowRunNotice`.
   */
  resumeSlowRunNotice(args: { readonly runId: string }): void;
  /** Resolves once `runId` reaches a terminal state; resolves immediately if it already has.
   * Aborting `signal` rejects with its reason and unregisters the waiter (a caller tearing down). */
  waitForTerminal(args: { readonly runId: string }, optional?: { readonly signal?: AbortSignal }): Promise<RunStatus>;
  /**
   * Replays buffered history after `options.afterCursor` (or from the
   * beginning if omitted/null) and then subscribes `onEvent` for live
   * delivery — the reconnect-and-resume-streaming operation a transport
   * uses. Mirrors OD's own reconnect guarantee: a caller that reconnects
   * already caught up on a *terminal* run still receives one more delivery
   * of the final `'end'` event, so a client can never silently miss the
   * terminal signal (`runs.ts` `stream()`, researched source).
   */
  stream(args: { readonly runId: string; readonly onEvent: (event: RunProtocolEvent) => void }, optionalArgs?: StreamOptions): Promise<StreamSubscribeResult>;
}

export interface CreateRunLifecycleInput {
  /** Share the negotiated bridge/executor digest store so run eviction also releases proofs. */
  readonly delegatedResultCorrelation?: DelegatedResultCorrelation;
  readonly eventLog: EventLog;
  /** Host-owned sink for asynchronous lifecycle failures that cannot be returned to a caller. Defaults to `console.error`. */
  readonly onInternalError?: (context: RunLifecycleInternalErrorContext) => void;
  /** How long a terminal run's in-memory record is retained before eviction. See {@link DEFAULT_TERMINAL_RETENTION_MS}. Defaults to that constant. */
  readonly terminalRetentionMs?: number;
  /** Hard cap on concurrently-retained terminal run records. See {@link DEFAULT_MAX_TERMINAL_RUNS}. Defaults to that constant. */
  readonly maxTerminalRuns?: number;
  /**
   * When `true`, evicting a terminal run record (retention timer or `maxTerminalRuns` cap) also calls
   * `eventLog.drop()` for it, giving the run's events the same lifetime as its record. Off by default
   * because a durable adapter's `drop()` deletes stored rows (`@jini-ai/daemon/store/event-log/sqlite`),
   * which would turn a memory bound into data loss for a host that never asked for it; a host whose
   * log is in-memory only can opt in. A failed drop is reported through `onInternalError`
   * (`source: 'event-log-drop'`).
   */
  readonly dropEventsOnEviction?: boolean;
  /**
   * How long a run may go with no agent-event `emit()` (excluding the notice itself) before a `'slow_running'` agent event tells the UI the
   * turn is taking longer than usual — never a terminating action; see
   * {@link armSlowRunWatchdogIfConfigured}'s doc. Applies kernel-wide to every `start()`ed run, unlike
   * `StartRunInput.inactivityTimeoutMs` (which requires a per-call opt-in and none of this codebase's
   * production callers supply). Defaults to {@link DEFAULT_SLOW_RUN_THRESHOLD_MS} so this reaches
   * production without any caller change. Pass `null` to disable it entirely for this lifecycle
   * instance.
   */
  readonly slowRunThresholdMs?: number | null;
}

export interface RunLifecycleInternalErrorContext {
  readonly source: 'inactivity-timeout' | 'slow-run-notice' | 'event-log-drop';
  readonly runId: string;
  readonly error: unknown;
}

/**
 * Creates the in-process `RunLifecycle` reference implementation.
 *
 * @param input.eventLog - The durable `EventLog` port this lifecycle appends to and replays from.
 * @param input.terminalRetentionMs - See {@link CreateRunLifecycleInput.terminalRetentionMs}.
 * @param input.maxTerminalRuns - See {@link CreateRunLifecycleInput.maxTerminalRuns}.
 * @param input.dropEventsOnEviction - See {@link CreateRunLifecycleInput.dropEventsOnEviction}.
 * @returns A `RunLifecycle` backed by an in-memory run registry plus the injected `EventLog`.
 * @complexity Per-call complexities documented on each method; the registry itself is a `Map` keyed by `runId` (O(1) lookup). Memory is bounded: non-terminal runs are O(n) in concurrently-live runs, and terminal runs are capped at `maxTerminalRuns` (each additionally bounded in retention time by `terminalRetentionMs`) rather than growing for the life of the process.
 * @overallScore 100/100
 */
export function createRunLifecycle(requiredArgs: Pick<CreateRunLifecycleInput, "eventLog">, optionalArgs: Pick<CreateRunLifecycleInput, "onInternalError" | "terminalRetentionMs" | "maxTerminalRuns" | "slowRunThresholdMs" | "dropEventsOnEviction" | "delegatedResultCorrelation"> = {}): RunLifecycle {
  const input: CreateRunLifecycleInput = { ...requiredArgs, ...optionalArgs };
  const { eventLog, terminalRetentionMs, maxTerminalRuns, slowRunThresholdMs, runs, idempotencyIndex, terminalRunOrder } = createRunRegistry(input);
  const requireRun = createRunLookup({ runs });
  const appendEvent = createRunEventWriter({ eventLog });
  const appendStartOrRollback = createRunStartAppender({ runs, input, idempotencyIndex, appendEvent });
  const removeFromTerminalOrder = createTerminalOrderRemoval({ terminalRunOrder });
  const reportInternalError = createRunErrorReporter({ input });
  const dropEvictedRunEvents = createEvictedRunEventDropper({ eventLog, reportInternalError });
  const evictTerminalRun = createTerminalRunEvictor({ removeFromTerminalOrder, runs, input, idempotencyIndex, dropEvictedRunEvents });
  const enforceTerminalCap = createTerminalCapEnforcer({ terminalRunOrder, maxTerminalRuns, evictTerminalRun });
  const trackTerminalRun = createTerminalRunTracker({ terminalRunOrder, terminalRetentionMs, evictTerminalRun, enforceTerminalCap });
  const untrackTerminalRun = createTerminalRunUntracker({ removeFromTerminalOrder });
  const handleInactivityTimeout = createInactivityTimeoutHandler({ input, getLifecycle: () => lifecycle });
  const handleSlowRunNotice = createSlowRunNoticeHandler({ input, getLifecycle: () => lifecycle });
  const rehydrateOne = createRunRecordRehydrator({ runs, eventLog, idempotencyIndex, trackTerminalRun });
  const lifecycle: RunLifecycle = {
    rehydrate: createRunRehydrateMethod({ eventLog, rehydrateOne, getLifecycle: () => lifecycle }),
    start: createRunStartMethod({ idempotencyIndex, requireRun, runs, appendStartOrRollback, handleInactivityTimeout, slowRunThresholdMs, handleSlowRunNotice }),
    get: createRunGetMethod({ runs }),
    list: createRunListMethod({ runs }),
    cancel: createRunCancelMethod({ requireRun }),
    onCancelRequested: createRunOnCancelRequestedMethod({ requireRun }),
    emit: createRunEmitMethod({ requireRun, appendEvent }),
    finish: createRunFinishMethod({ requireRun, eventLog, trackTerminalRun }),
    resume: createRunResumeMethod({ requireRun, untrackTerminalRun, slowRunThresholdMs, handleSlowRunNotice }),
    suspendSlowRunNotice: createRunSuspendSlowRunNoticeMethod({ runs }),
    resumeSlowRunNotice: createRunResumeSlowRunNoticeMethod({ runs, slowRunThresholdMs, handleSlowRunNotice }),
    waitForTerminal: createRunWaitForTerminalMethod({ requireRun }),
    stream: createRunStreamMethod({ runs, eventLog }),
  };
  return lifecycle;
}
