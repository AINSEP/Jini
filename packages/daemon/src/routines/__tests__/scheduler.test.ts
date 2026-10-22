import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoutineService } from '../scheduler.js';
import type { Routine, RoutinePersistence, RoutineRun, RoutineRunHandlerStart } from '../types.js';

class SharedRoutinePersistence implements RoutinePersistence {
  readonly runs: RoutineRun[] = [];
  readonly claimedSlots = new Set<string>();
  failScheduledInsertAttempts = 0;

  constructor(private readonly routines: Routine[]) {}

  list(): Routine[] {
    return this.routines;
  }

  insertRun({ run }: Parameters<RoutinePersistence["insertRun"]>[0], options: NonNullable<Parameters<RoutinePersistence["insertRun"]>[1]> = {}): boolean {
    if (options.scheduledSlotAt != null) {
      if (this.failScheduledInsertAttempts > 0) {
        this.failScheduledInsertAttempts -= 1;
        throw new Error('scheduled slot claim unavailable');
      }
      const key = `${run.routineId}:${options.scheduledSlotAt}`;
      if (this.claimedSlots.has(key)) return false;
      this.claimedSlots.add(key);
    }
    this.runs.push(run);
    return true;
  }

  updateRun({ id, patch }: Parameters<RoutinePersistence["updateRun"]>[0]): void {
    const run = this.runs.find((candidate) => candidate.id === id);
    if (run) Object.assign(run, patch);
  }

  getLatestRun({ routineId }: Parameters<RoutinePersistence["getLatestRun"]>[0]): RoutineRun | null {
    return this.runs.find((run) => run.routineId === routineId) ?? null;
  }
}

function fixtureRoutine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: 'routine-1',
    name: 'Daily brief',
    prompt: 'Summarize the day',
    schedule: { kind: 'hourly', minute: 1 },
    target: { mode: 'create_each_run' },
    skillId: null,
    agentId: null,
    context: {},
    enabled: true,
    nextRunAt: null,
    lastRun: null,
    createdAt: Date.UTC(2026, 4, 17, 0, 0),
    updatedAt: Date.UTC(2026, 4, 17, 0, 0),
    ...overrides,
  };
}

function handlerStart(agentRunId: string, onStart?: () => void): RoutineRunHandlerStart {
  const start = onStart ? { start: onStart } : {};
  return {
    projectId: 'project-1',
    conversationId: 'conversation-1',
    agentRunId,
    completion: Promise.resolve({ status: 'succeeded' }),
    ...start,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RoutineService.setRunHandler / lifecycle basics', () => {
  it('throws when runNow is called before a run handler is configured', async () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });
    await expect(service.runNow({ routineId: 'routine-1' })).rejects.toThrow('Routine run handler is not configured');
  });

  it('throws when runNow targets an unknown routine id', async () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });
    service.setRunHandler({ handler: async ({ runId }) => handlerStart(runId) });
    await expect(service.runNow({ routineId: 'missing' })).rejects.toThrow('Routine missing not found');
  });

  it('start() is idempotent and rescheduleOne()/unschedule() on an unstarted service are no-ops', () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });
    expect(() => service.rescheduleOne({ routineId: 'routine-1' })).not.toThrow();
    expect(() => service.unschedule({ routineId: 'routine-1' })).not.toThrow();
    expect(service.nextRunAt({ routineId: 'routine-1' })).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'));
    try {
      service.start({});
      service.start({}); // second call is a no-op (already started)
      expect(service.nextRunAt({ routineId: 'routine-1' })).not.toBeNull();
    } finally {
      service.stop({});
    }
  });

  it('rescheduleOne() is a no-op for an id with no matching routine once started', () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'));
    try {
      service.start({});
      expect(() => service.rescheduleOne({ routineId: 'missing-routine' })).not.toThrow();
      expect(service.nextRunAt({ routineId: 'missing-routine' })).toBeNull();
    } finally {
      service.stop({});
    }
  });

  it('does not schedule a disabled routine or one with no computable next-fire time', () => {
    const persistence = new SharedRoutinePersistence([
      fixtureRoutine({ id: 'disabled', enabled: false }),
      // A malformed (regex-rejecting) wall time returns null via nextWallTimeMatching's early
      // return, without reaching the unguarded `partsInTimezone` call — see schedule.test.ts's
      // "throws for an invalid timezone" test for why an invalid *timezone* is not used here.
      fixtureRoutine({ id: 'unschedulable', schedule: { kind: 'daily', time: 'not-a-time', timezone: 'UTC' } }),
    ]);
    const service = new RoutineService({ persistence: persistence });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'));
    try {
      service.start({});
      expect(service.nextRunAt({ routineId: 'disabled' })).toBeNull();
      expect(service.nextRunAt({ routineId: 'unschedulable' })).toBeNull();
    } finally {
      service.stop({});
    }
  });

  it('rescheduleAll() on an unstarted service is a no-op (started guard)', () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });
    expect(() => service.rescheduleAll({})).not.toThrow();
    expect(service.nextRunAt({ routineId: 'routine-1' })).toBeNull();
  });

  it('rescheduleAll() called again after start() clears the already-scheduled timer before recomputing it', () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'));
    try {
      service.start({});
      const firstFireAt = service.nextRunAt({ routineId: 'routine-1' });
      expect(firstFireAt).not.toBeNull();

      // A second, direct rescheduleAll() call (a host forcing a full recompute) must clear the
      // existing timer set (exercising the "existing timers present" branch of its own internal
      // cleanup loop, not just the always-empty pass start() itself takes) before rebuilding it.
      service.rescheduleAll({});
      expect(service.nextRunAt({ routineId: 'routine-1' })).not.toBeNull();
    } finally {
      service.stop({});
    }
  });

  it('rescheduleOne() called on an id that already has a scheduled timer clears it before recomputing', () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'));
    try {
      service.start({});
      expect(service.nextRunAt({ routineId: 'routine-1' })).not.toBeNull();
      // Unlike the create/PATCH-route call pattern (routine has no existing timer yet),
      // calling rescheduleOne a second time for the same id exercises clearing an existing one.
      service.rescheduleOne({ routineId: 'routine-1' });
      expect(service.nextRunAt({ routineId: 'routine-1' })).not.toBeNull();
    } finally {
      service.stop({});
    }
  });

  it('unschedule() on a started, actively-scheduled routine clears its timer', () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'));
    try {
      service.start({});
      expect(service.nextRunAt({ routineId: 'routine-1' })).not.toBeNull();
      service.unschedule({ routineId: 'routine-1' });
      expect(service.nextRunAt({ routineId: 'routine-1' })).toBeNull();
    } finally {
      service.stop({});
    }
  });
});

describe('RoutineService.retryScheduledSlot guards', () => {
  it('does not retry once the service has been stopped in the interim', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'));

    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let insertAttempts = 0;
    persistence.insertRun = ({ run }, options = {}) => {
      insertAttempts += 1;
      if (options.scheduledSlotAt != null) {
        // Simulate a concurrent stop() racing the durable write itself failing.
        service.stop({});
        throw new Error('insert exploded');
      }
      persistence.runs.push(run);
      return true;
    };

    service.setRunHandler({ handler: async ({ runId }) => handlerStart('agent-run-1') });

    service.start({});
    await vi.advanceTimersByTimeAsync(60_000);

    expect(insertAttempts).toBe(1);
    // retryScheduledSlot's `!this.started` guard fired, so no new timer was armed.
    expect(service.nextRunAt({ routineId: 'routine-1' })).toBeNull();
    errors.mockRestore();
  });

  it('does not retry once the routine has been removed from persistence in the interim', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'));

    const routineList = [fixtureRoutine()];
    const persistence = new SharedRoutinePersistence(routineList);
    const service = new RoutineService({ persistence: persistence });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    persistence.insertRun = (_run, options = {}) => {
      if (options.scheduledSlotAt != null) {
        // Simulate the routine being deleted concurrently with the failed durable write.
        routineList.length = 0;
        throw new Error('insert exploded');
      }
      return true;
    };

    service.setRunHandler({ handler: async () => handlerStart('agent-run-1') });

    try {
      service.start({});
      await vi.advanceTimersByTimeAsync(60_000);
      // retryScheduledSlot found no matching (or no longer enabled) routine, so it did not
      // re-arm a timer for the now-deleted id.
      expect(service.nextRunAt({ routineId: 'routine-1' })).toBeNull();
    } finally {
      service.stop({});
      errors.mockRestore();
    }
  });
});

describe('RoutineService — defensive internal re-checks', () => {
  it('the async execution closure re-checks the run handler at the point it actually calls it (redundant guard; TS `private` fields are not runtime-enforced, so this test overrides the instance property directly to prove the branch)', async () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });
    service.setRunHandler({ handler: async () => handlerStart('agent-run-1') });

    let reads = 0;
    const realHandler = (service as unknown as { runHandler: unknown }).runHandler;
    Object.defineProperty(service, 'runHandler', {
      configurable: true,
      get() {
        reads += 1;
        // First read is start_()'s own top-level guard; second is the async IIFE's re-check.
        return reads === 1 ? realHandler : null;
      },
    });

    await expect(service.runNow({ routineId: 'routine-1' })).rejects.toThrow('Routine run handler is not configured');
    expect(reads).toBeGreaterThanOrEqual(2);
  });
});

describe('RoutineService scheduled run idempotency', () => {
  it('starts only one scheduled run when two scheduler instances fire the same slot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'));

    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const first = new RoutineService({ persistence: persistence });
    const second = new RoutineService({ persistence: persistence });
    const starts: string[] = [];

    first.setRunHandler({ handler: async ({ runId }) => handlerStart('agent-run-1', () => starts.push(runId)) });
    second.setRunHandler({ handler: async ({ runId }) => handlerStart('agent-run-2', () => starts.push(runId)) });

    try {
      first.start({});
      second.start({});

      await vi.advanceTimersByTimeAsync(61_000);

      expect(starts).toHaveLength(1);
      expect(persistence.runs).toHaveLength(1);
      expect(persistence.claimedSlots).toEqual(new Set(['routine-1:1779012060000']));
    } finally {
      first.stop({});
      second.stop({});
    }
  });

  it('retries the same scheduled slot when durable run insertion fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'));

    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    persistence.failScheduledInsertAttempts = 1;
    const service = new RoutineService({ persistence: persistence });
    const starts: string[] = [];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    service.setRunHandler({ handler: async ({ runId }) => handlerStart('agent-run-1', () => starts.push(runId)) });

    try {
      service.start({});

      await vi.advanceTimersByTimeAsync(60_000);

      expect(starts).toHaveLength(0);
      expect(persistence.runs).toHaveLength(0);
      expect(persistence.claimedSlots.size).toBe(0);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(starts).toHaveLength(1);
      expect(persistence.runs).toHaveLength(1);
      expect(persistence.claimedSlots).toEqual(new Set(['routine-1:1779012060000']));
    } finally {
      service.stop({});
      errors.mockRestore();
    }
  });

  it('does not start a second run for a routine that already has one in flight (dedupe by inflight promise)', async () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });
    let handlerCalls = 0;
    let resolveCompletion!: () => void;
    const completion = new Promise<{ status: 'succeeded' }>((resolve) => {
      resolveCompletion = () => resolve({ status: 'succeeded' });
    });

    service.setRunHandler({ handler: async () => {
      handlerCalls += 1;
      return { projectId: 'p1', conversationId: 'c1', agentRunId: 'a1', completion };
    } });

    // `runNow`/`start_` are themselves `async` functions, so each call always returns a fresh
    // Promise wrapper even when the second call's `start_` synchronously returns the first call's
    // in-flight `promise` internally — asserting reference equality on the two outer promises
    // would be asserting on an implementation detail JS itself doesn't preserve. The dedup that
    // matters or (and is asserted below) is that the handler itself only runs once.
    const first = service.runNow({ routineId: 'routine-1' });
    const second = service.runNow({ routineId: 'routine-1' });

    resolveCompletion();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(secondResult).toEqual(firstResult);

    expect(handlerCalls).toBe(1);
  });

  it('terminates the in-memory run and persists real IDs when prepare fails after assigning them', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'));

    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const updatePatches: Array<Partial<RoutineRun>> = [];
    const originalUpdate = persistence.updateRun.bind(persistence);
    persistence.updateRun = ({ id, patch }) => {
      updatePatches.push({ ...patch });
      originalUpdate({ id, patch });
    };

    const service = new RoutineService({ persistence: persistence });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    let discardCalls = 0;
    let completionResolved = false;
    let resolveCompletion!: () => void;
    const completion = new Promise<{ status: 'canceled' }>((resolve) => {
      resolveCompletion = () => {
        completionResolved = true;
        resolve({ status: 'canceled' });
      };
    });

    service.setRunHandler({ handler: async () => {
      return {
        projectId: 'routine-pending-project',
        conversationId: 'routine-pending-conversation',
        agentRunId: 'routine-pending-run',
        completion,
        prepare: (run: RoutineRun) => {
          run.projectId = 'real-project';
          run.conversationId = 'real-conversation';
          run.agentRunId = 'real-agent-run';
          throw new Error('prepare exploded');
        },
        discard: () => {
          discardCalls += 1;
          resolveCompletion();
        },
        start: () => {
          throw new Error('start should not run after a failed prepare');
        },
      };
    } });

    try {
      service.start({});

      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(discardCalls).toBe(1);
      expect(completionResolved).toBe(true);

      expect(persistence.runs).toHaveLength(1);
      const stored = persistence.runs[0]!;
      expect(stored.status).toBe('failed');
      expect(stored.projectId).toBe('real-project');
      expect(stored.conversationId).toBe('real-conversation');
      expect(stored.agentRunId).toBe('real-agent-run');
      expect(stored.completedAt).toBeTypeOf('number');
      expect(stored.error).toContain('prepare exploded');

      const failurePatch = updatePatches.find((patch) => patch.status === 'failed');
      expect(failurePatch).toBeDefined();
      expect(failurePatch?.projectId).toBe('real-project');
      expect(failurePatch?.conversationId).toBe('real-conversation');
      expect(failurePatch?.agentRunId).toBe('real-agent-run');
    } finally {
      service.stop({});
      errors.mockRestore();
    }
  });

  it('does not persist scheduled placeholder IDs when prepare fails before assigning real IDs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'));

    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const updatePatches: Array<Partial<RoutineRun>> = [];
    const originalUpdate = persistence.updateRun.bind(persistence);
    persistence.updateRun = ({ id, patch }) => {
      updatePatches.push({ ...patch });
      originalUpdate({ id, patch });
    };

    const service = new RoutineService({ persistence: persistence });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    let discardCalls = 0;

    service.setRunHandler({ handler: async ({ runId }) => {
      return {
        projectId: `routine-pending-project-${runId}`,
        conversationId: `routine-pending-conv-${runId}`,
        agentRunId: 'agent-run-1',
        completion: Promise.resolve({ status: 'canceled' as const }),
        prepare: () => {
          throw new Error('project create failed');
        },
        discard: () => {
          discardCalls += 1;
        },
        start: () => {
          throw new Error('start should not run after a failed prepare');
        },
      };
    } });

    try {
      service.start({});

      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(discardCalls).toBe(1);
      expect(persistence.runs).toHaveLength(1);
      const stored = persistence.runs[0]!;
      expect(stored.status).toBe('failed');
      expect(stored.completedAt).toBeTypeOf('number');
      expect(stored.error).toContain('project create failed');
      expect(stored.projectId).toBe('');
      expect(stored.conversationId).toBe('');
      expect(stored.agentRunId).toBe('agent-run-1');

      const failurePatch = updatePatches.find((patch) => patch.status === 'failed');
      expect(failurePatch).toBeDefined();
      expect(failurePatch?.projectId).toBe('');
      expect(failurePatch?.conversationId).toBe('');
      expect(failurePatch?.agentRunId).toBe('agent-run-1');
    } finally {
      service.stop({});
      errors.mockRestore();
    }
  });

  it('prepares manual runs exactly once through the service path', async () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });
    let prepareCalls = 0;

    service.setRunHandler({ handler: async () => ({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
      completion: Promise.resolve({ status: 'succeeded' as const }),
      prepare: () => {
        prepareCalls += 1;
      },
    }) });

    await service.runNow({ routineId: 'routine-1' });
    await Promise.resolve();

    expect(prepareCalls).toBe(1);
    expect(persistence.runs).toHaveLength(1);
    expect(persistence.runs[0]).toMatchObject({
      trigger: 'manual',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
    });
  });

  it('returns prepared IDs from successful manual runs', async () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });

    service.setRunHandler({ handler: async () => ({
      projectId: 'routine-pending-project',
      conversationId: 'routine-pending-conversation',
      agentRunId: 'routine-pending-run',
      completion: Promise.resolve({ status: 'succeeded' as const }),
      prepare: (run: RoutineRun) => {
        run.projectId = 'real-project';
        run.conversationId = 'real-conversation';
        run.agentRunId = 'real-agent-run';
      },
    }) });

    const started = await service.runNow({ routineId: 'routine-1' });
    await Promise.resolve();

    expect(started).toMatchObject({
      projectId: 'real-project',
      conversationId: 'real-conversation',
      agentRunId: 'real-agent-run',
    });
    expect(persistence.runs).toHaveLength(1);
    expect(persistence.runs[0]).toMatchObject({
      trigger: 'manual',
      projectId: 'real-project',
      conversationId: 'real-conversation',
      agentRunId: 'real-agent-run',
    });
  });

  it('surfaces a synchronous start() failure and still marks the run failed', async () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });

    service.setRunHandler({ handler: async () => ({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
      // Deliberately pending (not `Promise.resolve(...)`): an already-settled completion's
      // `.then()` callback would otherwise race the synchronous `start()` throw below and
      // overwrite the 'failed' status this test asserts — realistic usage never resolves
      // `completion` before `start()` even runs, so a pending promise isolates the code path
      // under test instead of asserting on that unrelated ordering hazard.
      completion: new Promise(() => {}),
      start: () => {
        throw new Error('start blew up');
      },
    }) });

    await expect(service.runNow({ routineId: 'routine-1' })).rejects.toThrow('start blew up');
    expect(persistence.runs[0]?.status).toBe('failed');
    expect(persistence.runs[0]?.error).toContain('start blew up');
  });

  it('marks the run failed when the completion promise itself rejects', async () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });

    service.setRunHandler({ handler: async () => ({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
      completion: Promise.reject(new Error('completion rejected')),
    }) });

    await service.runNow({ routineId: 'routine-1' });
    // Let the completion .catch() microtask run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(persistence.runs[0]?.status).toBe('failed');
    expect(persistence.runs[0]?.error).toContain('completion rejected');
  });

  it('marks the run failed with the raw value when the completion promise rejects with a non-Error', async () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });

    service.setRunHandler({ handler: async () => ({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
      // eslint-disable-next-line prefer-promise-reject-errors
      completion: Promise.reject('raw completion rejection'),
    }) });

    await service.runNow({ routineId: 'routine-1' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(persistence.runs[0]?.status).toBe('failed');
    expect(persistence.runs[0]?.error).toBe('raw completion rejection');
  });

  it('records the raw value (not .message) when start() throws a non-Error', async () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });

    service.setRunHandler({ handler: async () => ({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
      completion: new Promise(() => {}),
      start: () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'raw start failure';
      },
    }) });

    const rejection = await service.runNow({ routineId: 'routine-1' }).catch((e) => e);
    expect(rejection).toBe('raw start failure');
    expect(persistence.runs[0]?.status).toBe('failed');
    expect(persistence.runs[0]?.error).toBe('raw start failure');
  });

  it('logs the raw value (not .message) when prepare fails and its own discard cleanup also throws a non-Error', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'));
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    service.setRunHandler({ handler: async () => ({
      projectId: 'routine-pending-project',
      conversationId: 'routine-pending-conversation',
      agentRunId: 'routine-pending-run',
      completion: Promise.resolve({ status: 'canceled' as const }),
      prepare: () => {
        throw new Error('prepare exploded');
      },
      discard: () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'raw discard failure';
      },
    }) });

    try {
      service.start({});
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(0);

      const logged = errors.mock.calls.find(
        (call) => String(call[0]).includes('prepare cleanup failed') && call[1] === 'raw discard failure',
      );
      expect(logged).toBeDefined();
    } finally {
      service.stop({});
      errors.mockRestore();
    }
  });

  it('marks the run canceled/succeeded per the completion result when it resolves normally', async () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });

    service.setRunHandler({ handler: async () => ({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
      completion: Promise.resolve({ status: 'succeeded' as const, summary: 'done' }),
    }) });

    await service.runNow({ routineId: 'routine-1' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(persistence.runs[0]?.status).toBe('succeeded');
    expect(persistence.runs[0]?.summary).toBe('done');
  });

  it('discards without persisting when insertRun returns false for a manual (non-scheduled) run', async () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const originalInsert = persistence.insertRun.bind(persistence);
    persistence.insertRun = () => false;
    const service = new RoutineService({ persistence: persistence });
    let discardCalls = 0;

    service.setRunHandler({ handler: async () => ({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
      completion: Promise.resolve({ status: 'succeeded' as const }),
      discard: () => {
        discardCalls += 1;
      },
    }) });

    const result = await service.runNow({ routineId: 'routine-1' });
    expect(discardCalls).toBe(1);
    expect(persistence.runs).toHaveLength(0);
    expect(result.agentRunId).toBe('agent-run-1');
    void originalInsert;
  });

  it('propagates the original insertRun error for a manual (non-scheduled) run when discard cleanup itself succeeds', async () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    persistence.insertRun = () => {
      throw new Error('insert exploded, but cleanup is fine');
    };
    const service = new RoutineService({ persistence: persistence });
    let discardCalls = 0;

    service.setRunHandler({ handler: async () => ({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
      completion: Promise.resolve({ status: 'succeeded' as const }),
      discard: () => {
        discardCalls += 1;
      },
    }) });

    await expect(service.runNow({ routineId: 'routine-1' })).rejects.toThrow('insert exploded, but cleanup is fine');
    expect(discardCalls).toBe(1);
    expect(persistence.runs).toHaveLength(0);
  });

  it('propagates a discard failure when insertRun returns false (duplicate scheduled slot) for a manual (non-scheduled) run', async () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    persistence.insertRun = () => false;
    const service = new RoutineService({ persistence: persistence });

    service.setRunHandler({ handler: async () => ({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
      completion: Promise.resolve({ status: 'succeeded' as const }),
      discardUnstarted: () => {
        throw new Error('discardUnstarted failed');
      },
    }) });

    await expect(service.runNow({ routineId: 'routine-1' })).rejects.toThrow('discardUnstarted failed');
  });

  it('propagates a discard failure when insertRun throws for a manual (non-scheduled) run', async () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    persistence.insertRun = () => {
      throw new Error('insert exploded');
    };
    const service = new RoutineService({ persistence: persistence });

    service.setRunHandler({ handler: async () => ({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
      completion: Promise.resolve({ status: 'succeeded' as const }),
      discard: () => {
        throw new Error('discard also failed');
      },
    }) });

    await expect(service.runNow({ routineId: 'routine-1' })).rejects.toThrow('discard also failed');
  });

  it('prefers discardUnstarted over discard when both are supplied and insertRun returns false', async () => {
    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    persistence.insertRun = () => false;
    const service = new RoutineService({ persistence: persistence });
    let discardCalls = 0;
    let discardUnstartedCalls = 0;

    service.setRunHandler({ handler: async () => ({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
      completion: Promise.resolve({ status: 'succeeded' as const }),
      discard: () => {
        discardCalls += 1;
      },
      discardUnstarted: () => {
        discardUnstartedCalls += 1;
      },
    }) });

    await service.runNow({ routineId: 'routine-1' });
    expect(discardUnstartedCalls).toBe(1);
    expect(discardCalls).toBe(0);
  });

  it('still finalizes the failed row when prepare cleanup itself throws', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'));

    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    let discardCalls = 0;

    service.setRunHandler({ handler: async () => {
      return {
        projectId: 'routine-pending-project',
        conversationId: 'routine-pending-conversation',
        agentRunId: 'routine-pending-run',
        completion: Promise.resolve({ status: 'canceled' as const }),
        prepare: (run: RoutineRun) => {
          run.projectId = 'real-project';
          run.conversationId = 'real-conversation';
          run.agentRunId = 'real-agent-run';
          throw new Error('prepare exploded');
        },
        discard: () => {
          discardCalls += 1;
          throw new Error('cleanup blew up');
        },
        start: () => {},
      };
    } });

    try {
      service.start({});

      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(discardCalls).toBe(1);

      expect(
        errors.mock.calls.some((call) => call.some((value) => String(value).includes('cleanup blew up'))),
      ).toBe(true);
      expect(
        errors.mock.calls.some((call) => call.some((value) => String(value).includes('prepare exploded'))),
      ).toBe(true);

      expect(persistence.runs).toHaveLength(1);
      const stored = persistence.runs[0]!;
      expect(stored.status).toBe('failed');
      expect(stored.projectId).toBe('real-project');
      expect(stored.conversationId).toBe('real-conversation');
      expect(stored.agentRunId).toBe('real-agent-run');
      expect(stored.error).toContain('prepare exploded');
    } finally {
      service.stop({});
      errors.mockRestore();
    }
  });

  it('logs the raw (non-Error) originalError value and still retries the slot when a scheduled insertRun throw AND its discard cleanup both fail with non-Error values', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'));

    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    persistence.insertRun = () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'raw insert failure';
    };
    const service = new RoutineService({ persistence: persistence });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    service.setRunHandler({ handler: async () => ({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
      completion: Promise.resolve({ status: 'succeeded' as const }),
      discard: () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'raw discard failure';
      },
    }) });

    try {
      service.start({});
      await vi.advanceTimersByTimeAsync(60_000);

      // ScheduledRunPersistenceError wraps the raw discard failure as `originalError`; the
      // logger's ternary must fall through to the raw-value branch (not `.message`) for it.
      expect(errors).toHaveBeenCalled();
      const logged = errors.mock.calls[0]!;
      expect(String(logged[1])).toBe('raw discard failure');

      // A ScheduledRunPersistenceError retries the same slot rather than advancing the cadence —
      // still scheduled (not silently dropped) after the failed attempt.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(service.nextRunAt({ routineId: 'routine-1' })).not.toBeNull();
    } finally {
      service.stop({});
      errors.mockRestore();
    }
  });

  it('logs the raw (non-Error, non-ScheduledRunPersistenceError) value and reschedules the normal cadence when a scheduled run fails via a non-Error prepare() throw', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'));

    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    const service = new RoutineService({ persistence: persistence });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    service.setRunHandler({ handler: async () => ({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
      completion: Promise.resolve({ status: 'canceled' as const }),
      prepare: () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'raw prepare failure';
      },
      discard: () => {},
    }) });

    try {
      service.start({});
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(0);

      const logged = errors.mock.calls.find((call) => String(call[1]) === 'raw prepare failure');
      expect(logged).toBeDefined();

      // Not a ScheduledRunPersistenceError, so the scheduler advances to the next normal cadence
      // (rescheduleOne) instead of retrying the exact same slot.
      expect(service.nextRunAt({ routineId: 'routine-1' })).not.toBeNull();
    } finally {
      service.stop({});
      errors.mockRestore();
    }
  });

  it('retries the same scheduled slot when duplicate loser cleanup fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'));

    const persistence = new SharedRoutinePersistence([fixtureRoutine()]);
    persistence.claimedSlots.add('routine-1:1779012060000');
    const service = new RoutineService({ persistence: persistence });
    let discardAttempts = 0;
    let discardFailures = 1;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    service.setRunHandler({ handler: async ({ runId }) => {
      return {
        ...handlerStart(runId),
        discard: () => {
          discardAttempts += 1;
          if (discardFailures > 0) {
            discardFailures -= 1;
            throw new Error('duplicate loser cleanup failed');
          }
        },
      };
    } });

    try {
      service.start({});

      await vi.advanceTimersByTimeAsync(60_000);

      expect(discardAttempts).toBe(1);
      expect(persistence.runs).toHaveLength(0);
      expect(persistence.claimedSlots).toEqual(new Set(['routine-1:1779012060000']));

      await vi.advanceTimersByTimeAsync(1_000);

      expect(discardAttempts).toBe(2);
      expect(persistence.runs).toHaveLength(0);
      expect(
        errors.mock.calls.some((call) => call.some((value) => String(value).includes('duplicate loser cleanup failed'))),
      ).toBe(true);
    } finally {
      service.stop({});
      errors.mockRestore();
    }
  });
});
