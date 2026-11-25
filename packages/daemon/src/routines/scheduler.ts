/**
 * `RoutineService` — a multi-routine scheduler: a list of user-defined routines, each with its
 * own schedule, that fires a host-registered run handler. Schedule kinds covered: hourly (every
 * hour at minute M), daily (HH:MM in timezone), weekdays (Mon-Fri at HH:MM in timezone), weekly
 * (one weekday at HH:MM in timezone) — see {@link ./schedule.js} for the DST-safe wall-clock math
 * behind `nextRunAtForSchedule`. The run handler is host-owned: it is responsible for whatever
 * "firing a routine" means to a given consumer (project/conversation creation and dispatch into a
 * chat run, for OD) — this engine has no opinion on that, matching `RunLifecycle`'s existing
 * precedent for a kernel-owned, storage-injected service with a host-supplied driver.
 *
 * Ported from OD's `apps/daemon/src/routines.ts` (726 lines) per the porting proposal
 * (`ADS-memory/reports/proposals/PROP-http-route-packs-automation-routines-2026-07-21.md`,
 * Finding 2): "a genuinely clean, already-portable generic scheduling engine... ready to port
 * today as its own small, well-scoped task." Its only import was `node:crypto`'s `randomUUID`
 * (unchanged here); its `Routine`/`RoutineSchedule` types were already a documented local mirror,
 * not a product coupling (now `./types.js`); its `RoutinePersistence` injected port and
 * `RoutineRunHandler` callback preserve their behavior, with object arguments on the port (see `./types.js`'s doc comments for why
 * `RoutinePersistence` deliberately stays synchronous rather than converted to this package's
 * usual async-port convention). Logic is otherwise unchanged from the OD source — this is a
 * faithful port, not a redesign, per the proposal's own warning against "casually reinventing"
 * the race-safe scheduled-slot claim below.
 */
import { ClientFacingError } from '@jini-ai/core/contracts/server';
import { describeErrorForLog } from '@jini-ai/core';
import { randomUUID } from 'node:crypto';
import { createTimeoutScheduler, type SchedulerPort } from '../scheduler.js';
import { DurableScheduler, claimStrategy, type RoutineRunAttempt } from './durable-scheduler.js';
import type { ReconcileReason, RoutineDurablePersistence } from './types.js';
import { nextRunAtForSchedule } from './schedule.js';
import type {
  Routine,
  RoutinePersistence,
  RoutineRun,
  RoutineRunHandler,
  RoutineRunHandlerStart,
  RoutineRunTrigger,
} from './types.js';

interface ScheduledTimer {
  routineId: string;
  timer: () => void;
  fireAt: Date;
}

function clearRoutinePlaceholderId(value: string): string {
  return value.startsWith('routine-pending-') ? '' : value;
}

/**
 * Distinguishes "a sibling daemon already won this scheduled slot, or the durable write itself
 * failed" from every other run-handler failure, so the scheduler can retry the same slot instead
 * of silently advancing to the next cadence (which would skip a fire the caller never actually
 * got).
 */
export class ScheduledRunPersistenceError extends Error {
  readonly routineId: string;
  readonly slotAt: number;
  readonly originalError: unknown;
  constructor({ routineId, slotAt, originalError }: { readonly routineId: string; readonly slotAt: number; readonly originalError: unknown }
  ) {
    super(`Routine ${routineId} scheduled slot ${slotAt} could not be persisted`);
    this.routineId = routineId;
    this.slotAt = slotAt;
    this.originalError = originalError;
    this.name = 'ScheduledRunPersistenceError';
  }
}

/** Preserve the underlying failure (including its code) for the redacted log diagnostic. */
function scheduledRunFailureDetail(error: unknown): unknown {
  const cause = error instanceof ScheduledRunPersistenceError ? error.originalError : error;
  return cause;
}
function isScheduledRunPersistenceError(error: unknown): error is ScheduledRunPersistenceError {
  return error instanceof ScheduledRunPersistenceError;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class RoutineActiveError extends Error {
  constructor() { super('Routine already has an active run'); this.name = 'RoutineActiveError'; }
}

export class RoutineService {
  private timers = new Map<string, ScheduledTimer>();
  private inflight = new Map<string, Promise<RoutineRunHandlerStart>>();
  private runHandler: RoutineRunHandler | null = null;
  private started = false;
  private active = new Map<string, string>();
  private readonly durable: DurableScheduler | undefined;
  private readonly holderId: string | undefined;
  private readonly timerPort: SchedulerPort;

  private readonly persistence: RoutinePersistence;
  private readonly now: () => number;
  private readonly newId: () => string;
  constructor(
    { persistence }: { readonly persistence: RoutinePersistence },
    { now = Date.now, monotonicNow = () => performance.now(), newId = randomUUID, timers = createTimeoutScheduler({}, {}), holderId,
      graceMs = 60_000, maxArmMs = 300_000, leaseTtlMs = 90_000,
      policy = {}, log = (code, detail) => console.error(code, detail), onInterrupted = async () => {} }:
    { now?: () => number; monotonicNow?: () => number; newId?: () => string; timers?: SchedulerPort; holderId?: string;
      graceMs?: number; maxArmMs?: number; leaseTtlMs?: number;
      policy?: { activeSlotVisibility?: 'diagnostic-only'; catchUpOnAssistantEnable?: boolean };
      log?: (code: string, detail: unknown) => void;
      onInterrupted?: (required: { runs: RoutineRun[] }, optional: Record<string, never>) => Promise<void> } = {},
  ) {
    this.persistence = persistence;
    this.now = now;
    this.newId = newId;
    this.timerPort = timers;
    this.holderId = holderId;
    if ('claimDueSlot' in persistence) {
      if (!holderId) throw new Error('Durable routines require holderId');
      this.durable = new DurableScheduler({ persistence: persistence as RoutineDurablePersistence,
        now, monotonicNow, timers, holderId, graceMs, maxArmMs, leaseTtlMs, log, onInterrupted,
        policy: { activeSlotVisibility: policy.activeSlotVisibility ?? 'diagnostic-only',
          catchUpOnAssistantEnable: policy.catchUpOnAssistantEnable ?? false },
        fireSlot: (id, options) => this.start_(id, 'scheduled', options),
        pendingRunIds: () => [...this.active.values()],
      });
    }
  }

  setRunHandler({ handler }: { readonly handler: RoutineRunHandler }, _optional = {}): void {
    this.runHandler = handler;
  }

  start(_args: Record<string, never> = {}, { reason = 'start' }: { reason?: ReconcileReason } = {}): void {
    if (this.durable) { this.durable.start({}, { reason }); return; }
    if (this.started) return;
    this.started = true;
    this.rescheduleAll({});
  }

  stop(_args: Record<string, never>, { releaseLease = true } = {}): void {
    if (this.durable) { this.durable.stop({}, { releaseLease }); return; }
    for (const entry of this.timers.values()) entry.timer();
    this.timers.clear();
    this.started = false;
  }

  rescheduleAll(_args: Record<string, never>): void {
    if (this.durable) { void this.durable.reconcile({ reason: 'edit' }, {}); return; }
    for (const entry of this.timers.values()) entry.timer();
    this.timers.clear();
    if (!this.started) return;
    for (const routine of this.persistence.list()) {
      this.scheduleRoutine(routine);
    }
  }

  rescheduleOne({ routineId }: { readonly routineId: string }, _optional = {}): void {
    if (this.durable) { this.durable.rescheduleOne({ routineId }, {}); return; }
    const existing = this.timers.get(routineId);
    if (existing) {
      existing.timer();
      this.timers.delete(routineId);
    }
    if (!this.started) return;
    const routine = this.persistence.list().find((r) => r.id === routineId);
    if (routine) this.scheduleRoutine(routine);
  }

  unschedule({ routineId }: { readonly routineId: string }): void {
    if (this.durable) { this.durable.unschedule({ routineId }); return; }
    const existing = this.timers.get(routineId);
    if (existing) {
      existing.timer();
      this.timers.delete(routineId);
    }
  }

  whenReady(_required = {}, _optional = {}): Promise<void> { return this.durable?.whenReady({}, {}) ?? Promise.resolve(); }
  reconcile({ reason }: { reason: ReconcileReason }, _optional = {}): Promise<void> {
    if (this.durable) return this.durable.reconcile({ reason }, {});
    this.rescheduleAll({}); return Promise.resolve();
  }
  leaseState(_required = {}, _optional = {}): 'owner' | 'passive' | 'stopped' {
    return this.durable?.leaseState({}, {}) ?? (this.started ? 'owner' : 'stopped');
  }
  quiesce(_required = {}, _optional = {}): void {
    if (this.durable) this.durable.quiesce({}, {}); else this.stop({});
  }
  drainActive(_required = {}, { timeoutMs = 2000 } = {}): Promise<{ drained: boolean; pendingRunIds: string[] }> {
    return this.durable?.drainActive({}, { timeoutMs }) ?? Promise.resolve({ drained: true, pendingRunIds: [] });
  }

  private scheduleRoutine(routine: Routine): void {
    if (!routine.enabled) return;
    const fireAt = nextRunAtForSchedule({ schedule: routine.schedule }, { now: new Date(this.now()) });
    if (!fireAt) return;
    this.scheduleRoutineAt(routine, fireAt);
  }

  private retryScheduledSlot(routineId: string, fireAt: Date): void {
    if (!this.started) return;
    const routine = this.persistence.list().find((candidate) => candidate.id === routineId);
    if (!routine?.enabled) return;
    this.scheduleRoutineAt(routine, fireAt);
  }

  private scheduleRoutineAt(routine: Routine, fireAt: Date): void {
    // setTimeout can't carry past 2^31 ms (~24.8 days); we cap and use a chained re-schedule.
    // Routines fire within hours/days, but a misconfigured "next month" weekly value could
    // otherwise overflow.
    const delay = Math.max(1_000, Math.min(2_000_000_000, fireAt.getTime() - this.now()));
    const timer = this.timerPort.schedule({ delayMs: delay, callback: () => {
      this.timers.delete(routine.id);
      const slotAt = fireAt.getTime();
      this.start_(routine.id, 'scheduled', { scheduledSlotAt: slotAt })
        .then(() => {
          // Always reschedule so a single fire keeps the cadence alive.
          this.rescheduleOne({ routineId: routine.id });
        })
        .catch((error) => {
          console.error(
            `[@jini-ai/daemon] routine ${routine.id} scheduled run failed:`,
            describeErrorForLog({ err: scheduledRunFailureDetail(error) }),
          );
          if (isScheduledRunPersistenceError(error)) {
            this.retryScheduledSlot(routine.id, fireAt);
          } else {
            this.rescheduleOne({ routineId: routine.id });
          }
        });
    } });
    this.timers.set(routine.id, { routineId: routine.id, timer, fireAt });
  }

  nextRunAt({ routineId }: { readonly routineId: string }): Date | null {
    if (this.durable) return this.durable.nextRunAt({ routineId });
    return this.timers.get(routineId)?.fireAt ?? null;
  }

  async runNow({ routineId }: { readonly routineId: string }): Promise<RoutineRunHandlerStart> {
    return this.start_(routineId, 'manual', this.durable ? { current: this.durable.claimStrategy({}, {}) } : {});
  }

  /**
   * Wraps a persistence failure as a {@link ScheduledRunPersistenceError} when this attempt was a
   * scheduled fire, so the caller retries the same slot instead of advancing the cadence. Manual
   * fires have no slot to retry and surface the original error unchanged.
   */
  private asPersistenceFailure(attempt: RoutineRunAttempt, error: unknown): unknown {
    const slotAt = attempt.scheduledSlotAt;
    if (slotAt == null) return error;
    return new ScheduledRunPersistenceError({ routineId: attempt.routine.id, slotAt: slotAt, originalError: error });
  }

  /**
   * Tear-down for when the durable routine_run row was never inserted (insertRun threw, or another
   * daemon already won the slot). Prefers the explicit `discardUnstarted` callback when the handler
   * distinguishes the two cases — that one drops the in-memory chat run entirely instead of
   * finalizing it as `canceled`, so duplicate scheduled losers do not surface phantom runs on a run
   * listing. Handlers that do not implement the split still see `discard`.
   */
  private discardUnstartedRun(attempt: RoutineRunAttempt): void {
    const discardUnstarted = attempt.handlerStart.discardUnstarted ?? attempt.handlerStart.discard;
    try {
      discardUnstarted?.();
    } catch (discardError) {
      throw this.asPersistenceFailure(attempt, discardError);
    }
  }

  /**
   * Claims the durable routine_run row for this attempt. Returns `false` when a sibling daemon
   * already won the slot (the in-memory run has been discarded and the caller should just hand the
   * handler's start handle back); throws when the write itself failed.
   */
  private claimRunRow(attempt: RoutineRunAttempt): boolean {
    if (this.durable && attempt.current && !attempt.current()) {
      this.discardUnstartedRun(attempt);
      if (attempt.run.trigger === 'manual') throw new ClientFacingError({ apiError: { code: 'SERVICE_UNAVAILABLE', message: 'Routine lease lost', details: { reason: 'ROUTINES_UNAVAILABLE' } } });
      return false;
    }
    let inserted = true;
    try {
      if (this.durable && attempt.scheduledSlotAt !== undefined) {
        const result = (this.persistence as RoutineDurablePersistence).claimDueSlot({
          routineId: attempt.routine.id, expectedNextRunAt: attempt.scheduledSlotAt,
          nextRunAt: nextRunAtForSchedule({ schedule: attempt.routine.schedule },
            { now: new Date(Math.max(this.now(), attempt.scheduledSlotAt + 1)) })?.getTime() ?? null,
          run: attempt.run, holderId: this.holderId!, now: this.now(),
        }, {});
        inserted = result.claimed;
      } else inserted = this.persistence.insertRun({ run: attempt.run }, this.durable ? { ...attempt.insertOptions, now: this.now() } : attempt.insertOptions) !== false;
    } catch (error) {
      this.discardUnstartedRun(attempt);
      throw this.asPersistenceFailure(attempt, error);
    }
    if (inserted) { if (this.durable) this.active.set(attempt.routine.id, attempt.runId); return true; }
    this.discardUnstartedRun(attempt);
    if (this.durable && attempt.run.trigger === 'manual') throw new RoutineActiveError();
    return false;
  }

  /**
   * Copies the real project/conversation/run IDs `prepare()` resolved back onto the start handle and
   * persists them. Scheduled fires always write (the row was inserted with routine placeholders);
   * manual fires write only when `prepare()` actually changed something.
   */
  private persistPreparedIds(attempt: RoutineRunAttempt): void {
    const { handlerStart, run } = attempt;
    const preparedIdsChanged =
      run.projectId !== handlerStart.projectId
      || run.conversationId !== handlerStart.conversationId
      || run.agentRunId !== handlerStart.agentRunId
      || run.assistantMessageId !== handlerStart.assistantMessageId;
    handlerStart.projectId = run.projectId;
    handlerStart.conversationId = run.conversationId;
    handlerStart.agentRunId = run.agentRunId;
    if (this.durable) handlerStart.assistantMessageId = run.assistantMessageId ?? null;
    if (this.durable || attempt.scheduledSlotAt != null || preparedIdsChanged) {
      this.persistence.updateRun({ id: attempt.runId, patch: {
        projectId: run.projectId,
        conversationId: run.conversationId,
        agentRunId: run.agentRunId,
        ...(this.durable ? { assistantMessageId: run.assistantMessageId, agentId: run.agentId, model: run.model } : {}),
      } });
    }
  }

  /**
   * Finalizes a run whose `prepare()` step failed. Terminates the in-memory chat run created by
   * `handler(...)` so its `completion` promise resolves instead of waiting forever on a run that
   * will never start, surfacing (but not rethrowing) any cleanup failure, then persists the
   * terminal row.
   *
   * The placeholder IDs are cleared first: they are only replaced with real resources by
   * `prepare()`, so a failure before that enrichment would otherwise leave the terminal row
   * pointing at fabricated project/conversation IDs. For scheduled runs the slot claim was already
   * accepted at `insertRun()`, so retrying the same slot is not appropriate — the caller lets the
   * error propagate so the scheduler advances to the next cadence.
   */
  private finalizeUnpreparedRun(attempt: RoutineRunAttempt, error: unknown): void {
    const { run } = attempt;
    let discardError: unknown = null;
    try {
      attempt.handlerStart.discard?.();
    } catch (err) {
      discardError = err;
    }
    if (discardError != null) {
      console.error(
        `[@jini-ai/daemon] routine ${attempt.routine.id} prepare cleanup failed:`,
        describeErrorForLog({ err: discardError }),
      );
    }
    run.projectId = clearRoutinePlaceholderId(run.projectId);
    run.conversationId = clearRoutinePlaceholderId(run.conversationId);
    run.agentRunId = clearRoutinePlaceholderId(run.agentRunId);
    this.persistence.updateRun({ id: attempt.runId, patch: {
      status: 'failed',
      completedAt: this.now(),
      summary: null,
      error: errorMessage(error),
      errorCode: null,
      projectId: run.projectId,
      conversationId: run.conversationId,
      agentRunId: run.agentRunId,
      ...(this.durable ? { assistantMessageId: run.assistantMessageId, agentId: run.agentId, model: run.model } : {}),
    } });
    if (this.active.get(attempt.routine.id) === attempt.runId) this.active.delete(attempt.routine.id);
  }

  /** Persists the terminal row once the host's run completes (or its completion promise rejects). */
  private wireRunCompletion(attempt: RoutineRunAttempt): void {
    attempt.handlerStart.completion
      .then((completion) => {
        this.persistence.updateRun({ id: attempt.runId, patch: {
          status: completion.status,
          ...(this.durable ? { agentRunId: attempt.handlerStart.agentRunId } : {}),
          completedAt: this.now(),
          summary: completion.summary ?? null,
          error: completion.error ?? null,
          errorCode: completion.errorCode ?? null,
        } });
      })
      .catch((error) => {
        this.persistence.updateRun({ id: attempt.runId, patch: {
          status: 'failed',
          completedAt: this.now(),
          summary: null,
          error: errorMessage(error),
          errorCode: null,
        } });
      })
      .then(() => { if (this.active.get(attempt.routine.id) === attempt.runId) this.active.delete(attempt.routine.id); });
  }

  /** Hands control to the host's `start()`, finalizing the row as failed if it throws synchronously. */
  private startPreparedRun(attempt: RoutineRunAttempt): void | Promise<void> {
    try {
      const launched = attempt.handlerStart.start?.();
      if (this.durable) return Promise.resolve(launched).then(() => {
        this.persistence.updateRun({ id: attempt.runId, patch: { agentRunId: attempt.handlerStart.agentRunId } });
      }, (error) => { this.finalizeUnpreparedRun(attempt, error); throw error; });
    } catch (error) {
      this.persistence.updateRun({ id: attempt.runId, patch: {
        status: 'failed',
        completedAt: this.now(),
        summary: null,
        error: errorMessage(error),
        errorCode: null,
      } });
      if (this.active.get(attempt.routine.id) === attempt.runId) this.active.delete(attempt.routine.id);
      throw error;
    }
  }

  private async fireSlot(routine: Routine, trigger: RoutineRunTrigger, startedAt: number, runId: string,
    options: { scheduledSlotAt?: number; catchUp?: boolean; current?: () => boolean }): Promise<RoutineRunHandlerStart> {
    const handler = this.runHandler;
    if (!handler) throw new Error('Routine run handler is not configured');
    const handlerStart = await handler({ routine, trigger, startedAt, runId,
      ...(this.durable ? { catchUp: options.catchUp ?? false, slotAt: options.scheduledSlotAt ?? null } : {}),
    });
    const attempt = claimStrategy({ routine, trigger, startedAt, runId, handlerStart, options }, this.durable ? { holderId: this.holderId! } : {});
    const { run } = attempt;
    if (!this.claimRunRow(attempt)) return handlerStart;
    // `await` stays inline here rather than moving into a helper: wrapping it in an extra async
    // frame would add microtask ticks that callers observe.
    try {
      await handlerStart.prepare?.(run);
      this.persistPreparedIds(attempt);
    } catch (error) {
      this.finalizeUnpreparedRun(attempt, error);
      throw error;
    }
    this.wireRunCompletion(attempt);
    const launched = this.startPreparedRun(attempt);
    if (this.durable) await launched;
    return handlerStart;
  }

  private async start_(
    routineId: string,
    trigger: RoutineRunTrigger,
    options: { scheduledSlotAt?: number; catchUp?: boolean; current?: () => boolean } = {},
  ): Promise<RoutineRunHandlerStart> {
    if (!this.runHandler) throw new Error('Routine run handler is not configured');
    const inflight = this.inflight.get(routineId);
    if (inflight && !this.durable) return inflight;

    const routine = this.persistence.list().find((r) => r.id === routineId);
    if (!routine) throw new Error(`Routine ${routineId} not found`);

    const startedAt = this.now();
    const runId = `routine-run-${this.newId()}`;
    const promise = this.fireSlot(routine, trigger, startedAt, runId, options);
    this.inflight.set(routineId, promise);
    // The trailing `finally(...)` returns a new promise that mirrors the original rejection;
    // without `.catch` it would surface as an unhandled rejection (fatal in modern Node) when the
    // handler rejects before producing a start handle. The original `promise` is still returned
    // to callers, who handle the rejection there.
    promise
      .finally(() => {
        this.inflight.delete(routineId);
      })
      .catch(() => {});
    return promise;
  }
}
