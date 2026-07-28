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
      const scheduledSlotAt = options.scheduledSlotAt;
      const wasScheduled = scheduledSlotAt != null;
      const publicProjectId = () => clearRoutinePlaceholderId(run.projectId);
      const publicConversationId = () => clearRoutinePlaceholderId(run.conversationId);
      const publicAgentRunId = () => clearRoutinePlaceholderId(run.agentRunId);
      const scrubRoutinePlaceholders = () => {
        run.projectId = publicProjectId();
        run.conversationId = publicConversationId();
        run.agentRunId = publicAgentRunId();
      };
      // Tear-down to use when the durable routine_run row was never inserted (insertRun threw, or
      // another daemon already won the slot). Prefer the explicit `discardUnstarted` callback
      // when the handler distinguishes the two cases — that one drops the in-memory chat run
      // entirely instead of finalizing it as `canceled`, so duplicate scheduled losers do not
      // surface phantom runs on a run listing. Handlers that do not implement the split still see
      // `discard`.
      const discardUnstarted = handlerStart.discardUnstarted ?? handlerStart.discard;
      let inserted = true;
      try {
        inserted = this.persistence.insertRun(run, options) !== false;
      } catch (error) {
        try {
          discardUnstarted?.();
        } catch (discardError) {
          if (wasScheduled) {
            throw new ScheduledRunPersistenceError(routine.id, scheduledSlotAt, discardError);
          }
          throw discardError;
        }
        if (wasScheduled) {
          throw new ScheduledRunPersistenceError(routine.id, scheduledSlotAt, error);
        }
        throw error;
      }
      if (!inserted) {
        try {
          discardUnstarted?.();
        } catch (discardError) {
          if (wasScheduled) {
            throw new ScheduledRunPersistenceError(routine.id, scheduledSlotAt, discardError);
          }
          throw discardError;
        }
        return handlerStart;
      }
      try {
        await handlerStart.prepare?.(run);
        const preparedIdsChanged =
          run.projectId !== handlerStart.projectId
          || run.conversationId !== handlerStart.conversationId
          || run.agentRunId !== handlerStart.agentRunId;
        handlerStart.projectId = run.projectId;
        handlerStart.conversationId = run.conversationId;
        handlerStart.agentRunId = run.agentRunId;
        if (wasScheduled || preparedIdsChanged) {
          this.persistence.updateRun(runId, {
            projectId: run.projectId,
            conversationId: run.conversationId,
            agentRunId: run.agentRunId,
          });
        }
      } catch (error) {
        // Terminate the in-memory chat run created by `handler(...)` so its `completion` promise
        // resolves instead of waiting forever on a run that will never start. Surface any cleanup
        // failure rather than swallow it, but still finalize the persisted row.
        let discardError: unknown = null;
        try {
          handlerStart.discard?.();
        } catch (err) {
          discardError = err;
        }
        if (discardError != null) {
          console.error(
            `[@jini-ai/daemon] routine ${routine.id} prepare cleanup failed:`,
            discardError instanceof Error ? discardError.message : discardError,
          );
        }
        // Persist IDs only after `prepare()` has replaced routine placeholders with real
        // resources. If preparation failed before enrichment, clear the sentinels so the terminal
        // row does not point at fabricated project/conversation IDs. For scheduled runs the slot
        // claim was already accepted at `insertRun()`, so retrying the same slot is not
        // appropriate — let the error propagate so the scheduler advances to the next cadence.
        scrubRoutinePlaceholders();
        this.persistence.updateRun(runId, {
          status: 'failed',
          completedAt: Date.now(),
          summary: null,
          error: error instanceof Error ? error.message : String(error),
          errorCode: null,
          projectId: run.projectId,
          conversationId: run.conversationId,
          agentRunId: run.agentRunId,
        });
        throw error;
      }
      handlerStart.completion
        .then((completion) => {
          this.persistence.updateRun(runId, {
            status: completion.status,
            completedAt: Date.now(),
            summary: completion.summary ?? null,
            error: completion.error ?? null,
            errorCode: completion.errorCode ?? null,
          });
        })
        .catch((error) => {
          this.persistence.updateRun(runId, {
            status: 'failed',
            completedAt: Date.now(),
            summary: null,
            error: error instanceof Error ? error.message : String(error),
            errorCode: null,
          });
        });
      try {
        handlerStart.start?.();
      } catch (error) {
        this.persistence.updateRun(runId, {
          status: 'failed',
          completedAt: Date.now(),
          summary: null,
          error: error instanceof Error ? error.message : String(error),
          errorCode: null,
        });
        throw error;
      }
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
