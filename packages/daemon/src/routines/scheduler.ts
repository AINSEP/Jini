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
 * `RoutineRunHandler` callback are unchanged (see `./types.js`'s doc comments for why
 * `RoutinePersistence` deliberately stays synchronous rather than converted to this package's
 * usual async-port convention). Logic is otherwise unchanged from the OD source — this is a
 * faithful port, not a redesign, per the proposal's own warning against "casually reinventing"
 * the race-safe scheduled-slot claim below.
 */
import { randomUUID } from 'node:crypto';
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
  timer: NodeJS.Timeout;
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
  constructor(
    readonly routineId: string,
    readonly slotAt: number,
    readonly originalError: unknown,
  ) {
    super(`Routine ${routineId} scheduled slot ${slotAt} could not be persisted`);
    this.name = 'ScheduledRunPersistenceError';
  }
}

function isScheduledRunPersistenceError(error: unknown): error is ScheduledRunPersistenceError {
  return error instanceof ScheduledRunPersistenceError;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One in-flight attempt to fire a routine, threaded through the persistence steps of
 * {@link RoutineService.start_}. `scheduledSlotAt` is set only for a scheduled (not manual) fire —
 * its presence is what makes a persistence failure retryable against the same slot.
 */
interface RoutineRunAttempt {
  routine: Routine;
  run: RoutineRun;
  runId: string;
  handlerStart: RoutineRunHandlerStart;
  scheduledSlotAt: number | undefined;
  insertOptions: { scheduledSlotAt?: number };
}

export class RoutineService {
  private timers = new Map<string, ScheduledTimer>();
  private inflight = new Map<string, Promise<RoutineRunHandlerStart>>();
  private runHandler: RoutineRunHandler | null = null;
  private started = false;

  constructor(private readonly persistence: RoutinePersistence) {}

  setRunHandler(handler: RoutineRunHandler): void {
    this.runHandler = handler;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.rescheduleAll();
  }

  stop(): void {
    for (const entry of this.timers.values()) clearTimeout(entry.timer);
    this.timers.clear();
    this.started = false;
  }

  rescheduleAll(): void {
    for (const entry of this.timers.values()) clearTimeout(entry.timer);
    this.timers.clear();
    if (!this.started) return;
    for (const routine of this.persistence.list()) {
      this.scheduleRoutine(routine);
    }
  }

  rescheduleOne(routineId: string): void {
    const existing = this.timers.get(routineId);
    if (existing) {
      clearTimeout(existing.timer);
      this.timers.delete(routineId);
    }
    if (!this.started) return;
    const routine = this.persistence.list().find((r) => r.id === routineId);
    if (routine) this.scheduleRoutine(routine);
  }

  unschedule(routineId: string): void {
    const existing = this.timers.get(routineId);
    if (existing) {
      clearTimeout(existing.timer);
      this.timers.delete(routineId);
    }
  }

  private scheduleRoutine(routine: Routine): void {
    if (!routine.enabled) return;
    const fireAt = nextRunAtForSchedule(routine.schedule);
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
    const delay = Math.max(1_000, Math.min(2_000_000_000, fireAt.getTime() - Date.now()));
    const timer = setTimeout(() => {
      this.timers.delete(routine.id);
      const slotAt = fireAt.getTime();
      this.start_(routine.id, 'scheduled', { scheduledSlotAt: slotAt })
        .then(() => {
          // Always reschedule so a single fire keeps the cadence alive.
          this.rescheduleOne(routine.id);
        })
        .catch((error) => {
          console.error(
            `[@jini-ai/daemon] routine ${routine.id} scheduled run failed:`,
            error instanceof ScheduledRunPersistenceError
              ? error.originalError instanceof Error
                ? error.originalError.message
                : error.originalError
              : error instanceof Error
                ? error.message
                : error,
          );
          if (isScheduledRunPersistenceError(error)) {
            this.retryScheduledSlot(routine.id, fireAt);
          } else {
            this.rescheduleOne(routine.id);
          }
        });
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.set(routine.id, { routineId: routine.id, timer, fireAt });
  }

  nextRunAt(routineId: string): Date | null {
    return this.timers.get(routineId)?.fireAt ?? null;
  }

  async runNow(routineId: string): Promise<RoutineRunHandlerStart> {
    return this.start_(routineId, 'manual');
  }

  /**
   * Wraps a persistence failure as a {@link ScheduledRunPersistenceError} when this attempt was a
   * scheduled fire, so the caller retries the same slot instead of advancing the cadence. Manual
   * fires have no slot to retry and surface the original error unchanged.
   */
  private asPersistenceFailure(attempt: RoutineRunAttempt, error: unknown): unknown {
    const slotAt = attempt.scheduledSlotAt;
    if (slotAt == null) return error;
    return new ScheduledRunPersistenceError(attempt.routine.id, slotAt, error);
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
    let inserted = true;
    try {
      inserted = this.persistence.insertRun(attempt.run, attempt.insertOptions) !== false;
    } catch (error) {
      this.discardUnstartedRun(attempt);
      throw this.asPersistenceFailure(attempt, error);
    }
    if (inserted) return true;
    this.discardUnstartedRun(attempt);
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
      || run.agentRunId !== handlerStart.agentRunId;
    handlerStart.projectId = run.projectId;
    handlerStart.conversationId = run.conversationId;
    handlerStart.agentRunId = run.agentRunId;
    if (attempt.scheduledSlotAt != null || preparedIdsChanged) {
      this.persistence.updateRun(attempt.runId, {
        projectId: run.projectId,
        conversationId: run.conversationId,
        agentRunId: run.agentRunId,
      });
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
        errorMessage(discardError),
      );
    }
    run.projectId = clearRoutinePlaceholderId(run.projectId);
    run.conversationId = clearRoutinePlaceholderId(run.conversationId);
    run.agentRunId = clearRoutinePlaceholderId(run.agentRunId);
    this.persistence.updateRun(attempt.runId, {
      status: 'failed',
      completedAt: Date.now(),
      summary: null,
      error: errorMessage(error),
      errorCode: null,
      projectId: run.projectId,
      conversationId: run.conversationId,
      agentRunId: run.agentRunId,
    });
  }

  /** Persists the terminal row once the host's run completes (or its completion promise rejects). */
  private wireRunCompletion(attempt: RoutineRunAttempt): void {
    attempt.handlerStart.completion
      .then((completion) => {
        this.persistence.updateRun(attempt.runId, {
          status: completion.status,
          completedAt: Date.now(),
          summary: completion.summary ?? null,
          error: completion.error ?? null,
          errorCode: completion.errorCode ?? null,
        });
      })
      .catch((error) => {
        this.persistence.updateRun(attempt.runId, {
          status: 'failed',
          completedAt: Date.now(),
          summary: null,
          error: errorMessage(error),
          errorCode: null,
        });
      });
  }

  /** Hands control to the host's `start()`, finalizing the row as failed if it throws synchronously. */
  private startPreparedRun(attempt: RoutineRunAttempt): void {
    try {
      attempt.handlerStart.start?.();
    } catch (error) {
      this.persistence.updateRun(attempt.runId, {
        status: 'failed',
        completedAt: Date.now(),
        summary: null,
        error: errorMessage(error),
        errorCode: null,
      });
      throw error;
    }
  }

  private async start_(
    routineId: string,
    trigger: RoutineRunTrigger,
    options: { scheduledSlotAt?: number } = {},
  ): Promise<RoutineRunHandlerStart> {
    if (!this.runHandler) throw new Error('Routine run handler is not configured');
    const inflight = this.inflight.get(routineId);
    if (inflight) return inflight;

    const routine = this.persistence.list().find((r) => r.id === routineId);
    if (!routine) throw new Error(`Routine ${routineId} not found`);

    const startedAt = Date.now();
    const runId = `routine-run-${randomUUID()}`;
    const promise = (async () => {
      const handler = this.runHandler;
      if (!handler) throw new Error('Routine run handler is not configured');
      const handlerStart = await handler({ routine, trigger, startedAt, runId });
      const run: RoutineRun = {
        id: runId,
        routineId: routine.id,
        trigger,
        status: 'running',
        projectId: handlerStart.projectId,
        conversationId: handlerStart.conversationId,
        agentRunId: handlerStart.agentRunId,
        startedAt,
        completedAt: null,
        summary: null,
        error: null,
        errorCode: null,
      };
      const attempt: RoutineRunAttempt = {
        routine,
        run,
        runId,
        handlerStart,
        scheduledSlotAt: options.scheduledSlotAt,
        insertOptions: options,
      };
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
      this.startPreparedRun(attempt);
      return handlerStart;
    })();
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
