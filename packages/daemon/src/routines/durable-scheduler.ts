import { ClientFacingError } from '@jini-ai/core/contracts/server';
import { describeErrorForLog } from '@jini-ai/core';
import type { SchedulerPort } from '../scheduler.js';
import { nextRunAtForSchedule } from './schedule.js';
import { ScheduledRunPersistenceError } from './routine-errors.js';
import type { ReconcileReason, Routine, RoutineDurablePersistence, RoutineRun, RoutineRunHandlerStart, RoutineRunTrigger } from './types.js';

export class DurableScheduler {
  private state: 'owner' | 'passive' | 'stopped' = 'stopped';
  private accepting = false;
  private generation = 0;
  private generations = new Map<string, number>();
  private armed = new Map<string, { cancel: () => void; slotAt: number }>();
  private heartbeat: (() => void) | undefined;
  private retry: (() => void) | undefined;
  private drains = new Set<() => void>();
  private ready: Promise<void> = Promise.resolve();
  private resolveReady: (() => void) | undefined;
  private reason: ReconcileReason = 'start';
  /** Wall-clock expiry of the lease this process last wrote; past it, the row may already be someone else's. */
  private leaseExpiresAt = 0;
  /** The last wall/monotonic pair a passive acquire attempt saw (see {@link DurableScheduler.sleptSinceLastLook}). */
  private lastLook: { wall: number; mono: number } | undefined;

  constructor(private readonly input: {
    persistence: RoutineDurablePersistence; holderId: string; now: () => number; monotonicNow: () => number; timers: SchedulerPort;
    graceMs: number; maxArmMs: number; leaseTtlMs: number;
    policy: { activeSlotVisibility: 'diagnostic-only'; catchUpOnAssistantEnable: boolean };
    log: (code: string, detail: unknown) => void;
    onInterrupted: (required: { runs: RoutineRun[] }, optional: Record<string, never>) => Promise<void>;
    fireSlot: (routineId: string, options: { scheduledSlotAt: number; catchUp: boolean; current: () => boolean }) => Promise<unknown>;
    pendingRunIds: () => string[];
  }) {}

  start(_required = {}, { reason = 'start' }: { reason?: ReconcileReason } = {}): void {
    if (this.state !== 'stopped' && this.accepting) return;
    if (this.state === 'owner') { this.accepting = true; void this.reconcile({ reason }, {}); return; }
    this.reason = reason;
    this.accepting = true;
    this.ready = new Promise((resolve) => { this.resolveReady = resolve; });
    this.acquireLease();
  }

  whenReady(_required = {}, _optional = {}): Promise<void> { return this.ready; }
  leaseState(_required = {}, _optional = {}): 'owner' | 'passive' | 'stopped' { return this.state; }

  claimStrategy(_required = {}, _optional = {}): () => boolean {
    if (!this.accepting || this.state !== 'owner') throw new ClientFacingError({ apiError:
      { code: 'SERVICE_UNAVAILABLE', message: 'Routine lease lost', details: { reason: 'ROUTINES_UNAVAILABLE' } } });
    const generation = this.generation;
    return () => this.accepting && this.state === 'owner' && generation === this.generation;
  }

  private acquireLease(): void {
    const { persistence, holderId, now, leaseTtlMs } = this.input;
    // Sleep-safe takeover: when the whole machine slept past the TTL, every holder's lease looks
    // expired on wake, and whichever process's timer fires first could take over and interrupt a run
    // whose owner is alive and about to renew. A wall-vs-monotonic gap proves this process slept, so
    // it waits one more TTL of awake time; a live owner renews within TTL/3, a dead one does not.
    if (this.sleptSinceLastLook() || !persistence.acquireLease({ holderId, now: now(), ttlMs: leaseTtlMs }, {})) {
      this.goPassive();
      return;
    }
    this.state = 'owner';
    this.lastLook = undefined;
    this.leaseExpiresAt = now() + leaseTtlMs;
    const generation = this.generation;
    this.renewLease();
    void this.reconcileInFlight().then(() => {
      if (generation !== this.generation || this.state !== 'owner') return;
      void this.reconcile({ reason: this.reason }, {});
      this.resolveReady?.();
    });
  }

  /** True when wall time ran ahead of monotonic time since the last look by more than TTL/3 (a suspend). */
  private sleptSinceLastLook(): boolean {
    const look = { wall: this.input.now(), mono: this.input.monotonicNow() };
    const last = this.lastLook;
    this.lastLook = look;
    if (!last) return false;
    return (look.wall - last.wall) - (look.mono - last.mono) > this.input.leaseTtlMs / 3;
  }

  private goPassive(): void {
    this.state = 'passive';
    if (this.lastLook === undefined) this.lastLook = { wall: this.input.now(), mono: this.input.monotonicNow() };
    this.retry = this.input.timers.schedule({ delayMs: this.input.leaseTtlMs, callback: () => this.acquireLease() });
  }

  /** Fences every claim path the moment a renewal fails: no timer of this generation may fire again. */
  private loseLease(): void {
    this.generation += 1;
    for (const entry of this.armed.values()) entry.cancel();
    this.armed.clear();
    this.heartbeat?.();
    this.input.log('ROUTINES_LEASE_LOST', { holderId: this.input.holderId });
    this.goPassive();
  }

  /**
   * Fenced renew-on-wake. Timers run on monotonic time, so after a suspend the wall clock may be past
   * the lease this process wrote; renew (holder-checked in the store) before acting on any slot, and
   * fence if another holder has legitimately taken over meanwhile.
   */
  private ensureLease(): boolean {
    if (this.state !== 'owner') return false;
    const { persistence, holderId, now, leaseTtlMs } = this.input;
    if (now() < this.leaseExpiresAt) return true;
    if (persistence.acquireLease({ holderId, now: now(), ttlMs: leaseTtlMs }, {})) {
      this.leaseExpiresAt = now() + leaseTtlMs;
      return true;
    }
    this.loseLease();
    return false;
  }

  private renewLease(): void {
    const { timers, leaseTtlMs, persistence, holderId, now } = this.input;
    this.heartbeat = timers.schedule({ delayMs: leaseTtlMs / 3, callback: () => {
      if (this.state !== 'owner') return;
      if (!persistence.acquireLease({ holderId, now: now(), ttlMs: leaseTtlMs }, {})) { this.loseLease(); return; }
      this.leaseExpiresAt = now() + leaseTtlMs;
      this.renewLease();
    } });
  }

  private async reconcileInFlight(): Promise<void> {
    const { persistence, holderId, now, onInterrupted, log } = this.input;
    const runs = persistence.listInFlight({}, {});
    persistence.markInterrupted({ runIds: runs.map((r) => r.id), now: now(), holderId }, {});
    try { await onInterrupted({ runs }, {}); }
    catch (err) { log('ROUTINES_INTERRUPT_HOOK_FAILED', describeErrorForLog({ err })); }
  }

  async reconcile({ reason }: { reason: ReconcileReason }, _optional = {}): Promise<void> {
    if (this.state !== 'owner' || !this.accepting || !this.ensureLease()) return;
    const routines = this.input.persistence.list();
    for (const id of this.armed.keys()) {
      if (!routines.some((r) => r.id === id)) this.unschedule({ routineId: id });
    }
    await Promise.all(routines.map((routine) => this.applySlotDecision(routine, reason)));
  }

  rescheduleOne({ routineId }: { routineId: string }, _optional = {}): void {
    this.unschedule({ routineId });
    if (this.state !== 'owner' || !this.accepting) return;
    const routine = this.input.persistence.list().find((r) => r.id === routineId);
    if (routine) void this.applySlotDecision(routine, 'edit');
  }

  unschedule({ routineId }: { routineId: string }): void {
    this.generations.set(routineId, (this.generations.get(routineId) ?? 0) + 1);
    this.armed.get(routineId)?.cancel();
    this.armed.delete(routineId);
  }

  private classifySlot(routine: Routine, reason: ReconcileReason): 'seed' | 'future' | 'ordinary' | 'catch-up' | 'skip' {
    if (routine.nextRunAt === null) return 'seed';
    const lateness = this.input.now() - routine.nextRunAt;
    if (lateness < 0) return 'future';
    if (lateness <= this.input.graceMs) return 'ordinary';
    if (reason === 'enable' && !this.input.policy.catchUpOnAssistantEnable) return 'skip';
    return 'catch-up';
  }

  private async applySlotDecision(routine: Routine, reason: ReconcileReason): Promise<void> {
    if (!routine.enabled) { this.unschedule({ routineId: routine.id }); return; }
    const decision = this.classifySlot(routine, reason);
    if (decision === 'seed' || decision === 'skip') {
      const { persistence, holderId, now } = this.input;
      const nextRunAt = nextRunAtForSchedule({ schedule: routine.schedule }, { now: new Date(now()) })?.getTime() ?? null;
      if (!persistence.setNextRunAt({ routineId: routine.id, expected: routine.nextRunAt, nextRunAt, holderId, now: now() }, {})) {
        this.rearmFromStore(routine.id); return;
      }
      if (nextRunAt !== null) this.arm(routine.id, nextRunAt);
      return;
    }
    if (decision === 'future') { this.arm(routine.id, routine.nextRunAt!); return; }
    this.unschedule({ routineId: routine.id });
    await this.fireSlot(routine.id, routine.nextRunAt!, decision === 'catch-up', 0);
  }

  private arm(routineId: string, slotAt: number): void {
    this.unschedule({ routineId });
    const generation = this.generation;
    const localGeneration = this.generations.get(routineId);
    const current = () => this.accepting && this.state === 'owner' && this.generation === generation
      && this.generations.get(routineId) === localGeneration;
    const delayMs = Math.max(1000, Math.min(this.input.maxArmMs, slotAt - this.input.now()));
    const cancel = this.input.timers.schedule({ delayMs, callback: () => {
      if (!current()) return;
      this.armed.delete(routineId);
      void this.onTimer(routineId);
    } });
    this.armed.set(routineId, { cancel, slotAt });
  }

  private async onTimer(routineId: string): Promise<void> {
    if (!this.ensureLease()) return;
    const routine = this.input.persistence.list().find((r) => r.id === routineId);
    if (!routine) { this.unschedule({ routineId }); return; }
    await this.applySlotDecision(routine, 'wake');
  }

  private async fireSlot(routineId: string, slotAt: number, catchUp: boolean, retry: number): Promise<void> {
    const generation = this.generation;
    const localGeneration = this.generations.get(routineId);
    const current = () => this.accepting && this.state === 'owner' && generation === this.generation
      && localGeneration === this.generations.get(routineId);
    if (!current()) return;
    try {
      await this.input.fireSlot(routineId, { scheduledSlotAt: slotAt, catchUp, current });
    } catch (err) {
      if (err instanceof ScheduledRunPersistenceError && current()) {
        const delayMs = [1000, 2000, 4000, 8000, 16000][retry];
        if (delayMs !== undefined) {
          const cancel = this.input.timers.schedule({ delayMs, callback: () => {
            if (current()) void this.fireSlot(routineId, slotAt, catchUp, retry + 1);
          } });
          this.armed.set(routineId, { cancel, slotAt });
          return;
        }
        this.input.log('ROUTINE_SLOT_PERSIST_FAILED', describeErrorForLog({ err }));
        const cancel = this.input.timers.schedule({ delayMs: this.input.maxArmMs, callback: () => {
          if (current()) this.rearmFromStore(routineId);
        } });
        this.armed.set(routineId, { cancel, slotAt });
        return;
      }
      this.input.log('ROUTINE_RUN_FAILED', describeErrorForLog({ err }));
    }
    if (current()) this.rearmFromStore(routineId);
  }

  private rearmFromStore(routineId: string): void {
    this.unschedule({ routineId });
    if (this.state !== 'owner' || !this.accepting) return;
    const routine = this.input.persistence.list().find((r) => r.id === routineId);
    if (routine?.enabled && routine.nextRunAt !== null) this.arm(routineId, routine.nextRunAt);
  }

  nextRunAt({ routineId }: { routineId: string }): Date | null {
    const slotAt = this.armed.get(routineId)?.slotAt;
    return slotAt === undefined ? null : new Date(slotAt);
  }

  quiesce(_required = {}, _optional = {}): void {
    this.accepting = false;
    this.generation += 1;
    for (const entry of this.armed.values()) entry.cancel();
    this.armed.clear();
    this.retry?.();
  }

  drainActive(_required = {}, { timeoutMs = 2000 } = {}): Promise<{ drained: boolean; pendingRunIds: string[] }> {
    const deadline = this.input.now() + timeoutMs;
    return new Promise((resolve) => {
      let cancel = () => {};
      const finish = () => {
        cancel(); this.drains.delete(finish);
        const pendingRunIds = this.input.pendingRunIds();
        resolve({ drained: pendingRunIds.length === 0, pendingRunIds });
      };
      this.drains.add(finish);
      const poll = () => {
        const pendingRunIds = this.input.pendingRunIds();
        if (pendingRunIds.length === 0 || this.input.now() >= deadline) {
          finish(); return;
        }
        cancel = this.input.timers.schedule({ delayMs: Math.min(50, deadline - this.input.now()), callback: poll });
      };
      poll();
    });
  }

  stop(_required = {}, { releaseLease = true } = {}): void {
    this.quiesce({}, {});
    this.heartbeat?.();
    for (const cancel of this.drains) cancel();
    if (releaseLease && this.state === 'owner') this.input.persistence.releaseLease({ holderId: this.input.holderId }, {});
    this.state = 'stopped';
  }
}

/**
 * One in-flight attempt to fire a routine, threaded through the persistence steps of
 * {@link RoutineService.start_}. `scheduledSlotAt` is set only for a scheduled (not manual) fire —
 * its presence is what makes a persistence failure retryable against the same slot.
 */
export interface RoutineRunAttempt {
  routine: Routine;
  run: RoutineRun;
  runId: string;
  handlerStart: RoutineRunHandlerStart;
  scheduledSlotAt: number | undefined;
  insertOptions: { scheduledSlotAt?: number; holderId?: string; now?: number };
  current?: () => boolean;
}

export function claimStrategy(
  { routine, trigger, startedAt, runId, handlerStart, options }: {
    routine: Routine; trigger: RoutineRunTrigger; startedAt: number; runId: string; handlerStart: RoutineRunHandlerStart;
    options: { scheduledSlotAt?: number; catchUp?: boolean; current?: () => boolean };
  }, { holderId }: { holderId?: string } = {},
): RoutineRunAttempt {
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
    ...(holderId !== undefined ? { catchUp: options.catchUp ?? false, slotAt: options.scheduledSlotAt ?? null,
      holderId, approvalState: 'none' as const, approvalRef: null, approvalSince: null,
      assistantMessageId: handlerStart.assistantMessageId ?? null } : {}),
  };
  return {
    routine,
    run,
    runId,
    handlerStart,
    scheduledSlotAt: options.scheduledSlotAt,
    insertOptions: holderId !== undefined ? { ...options, holderId, now: startedAt } : options,
    ...(options.current ? { current: options.current } : {}),
  };
}

