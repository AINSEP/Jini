import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoutineService } from '../scheduler.js';
import type { Routine, RoutineDurablePersistence, RoutineRun, RoutineRunHandlerStart, RoutineRunHandler } from '../types.js';

const hour = 3_600_000;
const boot = Date.UTC(2026, 10, 24, 12);
function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(boot);
  const routine: Routine = { id: 'r', name: 'Brief', prompt: 'Brief', schedule: { kind: 'hourly', minute: 0 },
    target: { mode: 'create_each_run' }, skillId: null, agentId: null, context: {}, enabled: true,
    nextRunAt: boot + hour, lastRun: null, createdAt: 1, updatedAt: 1, revision: 1, creatorId: 'owner', model: null };
  const runs: RoutineRun[] = [];
  let holder = '';
  let expiry = 0;
  const persistence: RoutineDurablePersistence = {
    list: () => [routine],
    insertRun: ({ run }, options = {}) => {
      if (holder !== options.holderId || expiry <= Date.now()) return false;
      if (runs.some((r) => r.routineId === run.routineId && r.status === 'running')) return false;
      runs.push({ ...run }); return true;
    },
    updateRun: ({ id, patch }) => { const row = runs.find((r) => r.id === id); if (row) Object.assign(row, patch); },
    getLatestRun: () => runs.at(-1) ?? null,
    claimDueSlot: vi.fn<RoutineDurablePersistence['claimDueSlot']>(({ expectedNextRunAt, nextRunAt, run, holderId, now }) => {
      if (holder !== holderId || expiry <= now) return { claimed: false, reason: 'lease-lost' };
      if (!routine.enabled) return { claimed: false, reason: 'disabled' };
      if (routine.nextRunAt !== expectedNextRunAt) return { claimed: false, reason: 'slot-moved' };
      routine.nextRunAt = nextRunAt;
      if (runs.some((r) => r.status === 'running')) return { claimed: false, reason: 'active-run' };
      runs.push({ ...run }); return { claimed: true };
    }),
    setNextRunAt: ({ expected, nextRunAt, holderId, now }) => {
      if (holder !== holderId || expiry <= now || routine.nextRunAt !== expected) return false;
      routine.nextRunAt = nextRunAt; return true;
    },
    listInFlight: ({ excludeHolderId } = {}) => runs.filter((r) => r.status === 'running' && r.holderId !== excludeHolderId),
    markInterrupted: vi.fn<RoutineDurablePersistence['markInterrupted']>(({ runIds }) => { for (const r of runs) if (runIds.includes(r.id)) r.status = 'interrupted'; }),
    acquireLease: vi.fn<RoutineDurablePersistence['acquireLease']>(({ holderId, now, ttlMs }) => {
      if (holder && holder !== holderId && expiry > now) return false;
      holder = holderId; expiry = now + ttlMs; return true;
    }),
    releaseLease: vi.fn<RoutineDurablePersistence['releaseLease']>(({ holderId }) => { if (holder === holderId) { holder = ''; expiry = 0; } }),
  };
  let id = 0;
  const log = vi.fn();
  const onInterrupted = vi.fn(async () => {});
  const service = new RoutineService({ persistence }, { holderId: 'a', now: Date.now, newId: () => String(++id), log, onInterrupted });
  const prepare = vi.fn();
  const start = vi.fn();
  const discardUnstarted = vi.fn();
  const handle: RoutineRunHandlerStart = { projectId: '', conversationId: 'c', agentRunId: '',
    assistantMessageId: 'm', completion: new Promise(() => {}), prepare, start, discardUnstarted };
  const handler = vi.fn(async (_input: Parameters<RoutineRunHandler>[0]) => handle);
  service.setRunHandler({ handler });
  return { routine, runs, persistence, service, handler, handle, prepare, start, discardUnstarted, log, onInterrupted };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('durable routine slots', () => {
  it('restart after three missed slots fires once with catchUp and schedules the next future slot', async () => {
    const f = fixture(); f.routine.nextRunAt = boot - 3 * hour;
    f.service.start({}); await f.service.whenReady({}, {}); await vi.advanceTimersByTimeAsync(0);
    expect(f.handler).toHaveBeenCalledTimes(1);
    expect(f.handler.mock.calls[0]?.[0]).toMatchObject({ catchUp: true, slotAt: boot - 3 * hour });
    expect(f.routine.nextRunAt).toBe(boot + hour);
    f.service.stop({});
  });
  it('20 ms late timer is not catch-up', async () => {
    const f = fixture(); f.routine.nextRunAt = boot - 20;
    f.service.start({}); await f.service.whenReady({}, {});
    expect(f.handler.mock.calls[0]?.[0]).toMatchObject({ catchUp: false, slotAt: boot - 20 });
    f.service.stop({});
  });
  it("paused routine's old timer does nothing", async () => {
    const f = fixture(); f.routine.nextRunAt = boot + 1000;
    f.service.start({}); await f.service.whenReady({}, {});
    let release!: () => void;
    f.handler.mockImplementation(async () => { await new Promise<void>((r) => { release = r; }); return f.handle; });
    await vi.advanceTimersByTimeAsync(1000);
    f.routine.enabled = false; f.service.rescheduleOne({ routineId: 'r' }); release();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.persistence.claimDueSlot).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
    f.service.stop({});
  });
  it('claim loser creates no conversation', async () => {
    const f = fixture(); f.routine.nextRunAt = boot;
    vi.mocked(f.persistence.claimDueSlot).mockImplementation(() => { f.routine.nextRunAt = boot + hour; return { claimed: false, reason: 'slot-moved' }; });
    f.service.start({}); await f.service.whenReady({}, {});
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
    expect(f.discardUnstarted).toHaveBeenCalledTimes(1); f.service.stop({});
  });
  it('pending run across the next slot consumes it without a second run', async () => {
    const f = fixture(); f.routine.nextRunAt = boot;
    f.service.start({}); await f.service.whenReady({}, {});
    await vi.advanceTimersByTimeAsync(hour);
    expect(f.runs).toHaveLength(1); expect(f.start).toHaveBeenCalledTimes(1);
    expect(f.routine.nextRunAt).toBe(boot + 2 * hour); f.service.stop({});
  });
  it('crash after claim records Interrupted and keeps the next slot', async () => {
    const f = fixture(); f.routine.nextRunAt = boot;
    f.service.start({}); await f.service.whenReady({}, {}); f.service.stop({});
    const next = f.routine.nextRunAt;
    const second = new RoutineService({ persistence: f.persistence }, { holderId: 'b', onInterrupted: f.onInterrupted });
    second.start({}); await second.whenReady({}, {});
    expect(f.runs[0]?.status).toBe('interrupted'); expect(f.routine.nextRunAt).toBe(next);
    expect(f.onInterrupted).toHaveBeenCalledWith({ runs: expect.arrayContaining([expect.objectContaining({ id: f.runs[0]?.id })]) }, {});
    second.stop({});
  });
  it('lease lost while handler awaits: claim returns lease-lost, prepare never called', async () => {
    const f = fixture(); f.routine.nextRunAt = boot + 1000;
    f.service.start({}); await f.service.whenReady({}, {});
    let release!: () => void;
    f.handler.mockImplementation(async () => { await new Promise<void>((r) => { release = r; }); return f.handle; });
    await vi.advanceTimersByTimeAsync(1000);
    f.persistence.releaseLease({ holderId: 'a' }, {});
    f.persistence.acquireLease({ holderId: 'b', now: Date.now(), ttlMs: 90_000 }, {});
    release(); await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(f.persistence.claimDueSlot).mock.results[0]?.value).toEqual({ claimed: false, reason: 'lease-lost' });
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.discardUnstarted).toHaveBeenCalledTimes(1); f.service.stop({});
  });
  it('heartbeat renew false stops claims and logs ROUTINES_LEASE_LOST', async () => {
    const f = fixture(); f.service.start({}); await f.service.whenReady({}, {});
    vi.mocked(f.persistence.acquireLease).mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.service.leaseState({}, {})).toBe('passive');
    expect(f.log).toHaveBeenCalledWith('ROUTINES_LEASE_LOST', expect.anything());
    await vi.advanceTimersByTimeAsync(hour); expect(f.persistence.claimDueSlot).not.toHaveBeenCalled(); f.service.stop({});
  });
  it('wake reconcile fires once; a second wake does not', async () => {
    const f = fixture(); f.service.start({}); await f.service.whenReady({}, {});
    vi.setSystemTime(boot + 3 * hour);
    await f.service.reconcile({ reason: 'wake' }, {}); await f.service.reconcile({ reason: 'wake' }, {});
    expect(f.runs).toHaveLength(1); expect(f.runs[0]).toMatchObject({ catchUp: true, slotAt: boot + hour }); f.service.stop({});
  });
  it('lost claim reloads and does not run', async () => {
    const f = fixture(); f.routine.nextRunAt = boot;
    vi.mocked(f.persistence.claimDueSlot).mockImplementation(() => { f.routine.nextRunAt = boot + 2 * hour; return { claimed: false, reason: 'slot-moved' }; });
    // whenReady covers the lease and boot interruption only; the first slot decision settles a tick later.
    f.service.start({}); await f.service.whenReady({}, {}); await vi.advanceTimersByTimeAsync(0);
    expect(f.start).not.toHaveBeenCalled(); expect(f.service.nextRunAt({ routineId: 'r' })?.getTime()).toBe(boot + 2 * hour); f.service.stop({});
  });
  it('clock set back one hour re-arms and does not refire the same slot', async () => {
    const f = fixture(); f.routine.nextRunAt = boot + 1000;
    f.service.start({}); await f.service.whenReady({}, {});
    vi.setSystemTime(boot - hour); await vi.advanceTimersByTimeAsync(1000);
    expect(f.handler).not.toHaveBeenCalled(); expect(f.routine.nextRunAt).toBe(boot + 1000); f.service.stop({});
  });
  it('late timer and wake reconcile race produce one run', async () => {
    const f = fixture(); f.routine.nextRunAt = boot + 1000;
    f.service.start({}); await f.service.whenReady({}, {});
    vi.setSystemTime(boot + 2 * hour);
    await Promise.all([f.service.reconcile({ reason: 'wake' }, {}), vi.advanceTimersByTimeAsync(1000)]);
    expect(f.runs).toHaveLength(1); expect(f.start).toHaveBeenCalledTimes(1); f.service.stop({});
  });
  it('re-enabling the assistant skips overdue slots without running', async () => {
    const f = fixture(); f.routine.nextRunAt = boot - 3 * hour;
    f.service.start({}, { reason: 'enable' }); await f.service.whenReady({}, {});
    expect(f.handler).not.toHaveBeenCalled(); expect(f.routine.nextRunAt).toBe(boot + hour); f.service.stop({});
  });
  it('passive start arms no timers and retries after leaseTtlMs', async () => {
    const f = fixture(); f.persistence.acquireLease({ holderId: 'b', now: boot, ttlMs: 90_000 }, {});
    f.service.start({}, { reason: 'enable' });
    expect(f.service.leaseState({}, {})).toBe('passive'); expect(f.service.nextRunAt({ routineId: 'r' })).toBeNull();
    await vi.advanceTimersByTimeAsync(89_999); expect(f.persistence.acquireLease).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); await f.service.whenReady({}, {});
    expect(f.service.leaseState({}, {})).toBe('owner'); f.service.stop({});
  });
  it("passive process never marks the owner's in-flight runs interrupted", async () => {
    const f = fixture(); f.persistence.acquireLease({ holderId: 'b', now: boot, ttlMs: 90_000 }, {});
    f.service.start({}); await vi.advanceTimersByTimeAsync(0);
    expect(f.persistence.markInterrupted).not.toHaveBeenCalled(); expect(f.onInterrupted).not.toHaveBeenCalled(); f.service.stop({});
  });
  it('quiesce retains the lease through the drain', async () => {
    const f = fixture(); f.routine.nextRunAt = boot; f.service.start({}); await f.service.whenReady({}, {});
    f.service.quiesce({}, {}); const draining = f.service.drainActive({}, { timeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await draining).toEqual({ drained: false, pendingRunIds: [f.runs[0]!.id] });
    expect(f.persistence.releaseLease).not.toHaveBeenCalled(); expect(f.service.leaseState({}, {})).toBe('owner'); f.service.stop({});
  });
  it('rejected interruption hook logs and still arms', async () => {
    const f = fixture(); f.onInterrupted.mockRejectedValue(new Error('private hook failure'));
    f.service.start({}); await f.service.whenReady({}, {});
    expect(f.log).toHaveBeenCalledWith('ROUTINES_INTERRUPT_HOOK_FAILED', expect.anything());
    expect(f.service.nextRunAt({ routineId: 'r' })?.getTime()).toBe(boot + hour); f.service.stop({});
  });
});

it('refuses a manual run before owning the lease and permits it after acquiring the lease', async () => {
  const f = fixture();
  try {
    await expect(f.service.runNow({ routineId: 'r' })).rejects.toMatchObject({ apiError: {
      code: 'SERVICE_UNAVAILABLE', message: 'Routine lease lost', details: { reason: 'ROUTINES_UNAVAILABLE' },
    } });
    expect(f.handler).not.toHaveBeenCalled();
    f.service.start({});
    await f.service.whenReady();
    expect(await f.service.runNow({ routineId: 'r' })).toMatchObject({ conversationId: 'c' });
    expect(f.runs).toMatchObject([{ routineId: 'r', trigger: 'manual', status: 'running' }]);
  } finally { f.service.stop({}); }
});

it('stop completes a waiting drain without leaving it blocked until the timeout', async () => {
  const f = fixture();
  f.service.start({});
  try {
    await f.service.whenReady();
    await f.service.runNow({ routineId: 'r' });
    const pendingRunIds = f.runs.map(({ id }) => id);
    expect(pendingRunIds).toEqual(['routine-run-1']);
    const drained = vi.fn();
    const drain = f.service.drainActive({}, { timeoutMs: 2000 });
    void drain.then(drained);
    await vi.advanceTimersByTimeAsync(50);
    expect(drained).not.toHaveBeenCalled();
    f.service.stop({});
    await Promise.resolve();
    expect(drained.mock.calls).toEqual([[{ drained: false, pendingRunIds }]]);
    expect(f.service.leaseState()).toBe('stopped');
  } finally { f.service.stop({}); }
});

it('leaves an exhausted slot unclaimed and rearms from storage after the retry backoff', async () => {
  const f = fixture();
  f.routine.nextRunAt = boot;
  const claim = vi.mocked(f.persistence.claimDueSlot);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    claim.mockImplementationOnce(() => { throw new Error('temporary write failure'); });
  }
  f.service.start({});
  try {
    await f.service.whenReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(claim).toHaveBeenCalledTimes(1);
    for (const [index, delay] of [1000, 2000, 4000, 8000, 16000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(claim).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(claim).toHaveBeenCalledTimes(index + 2);
    }
    expect(f.log.mock.calls).toEqual([['ROUTINE_SLOT_PERSIST_FAILED', 'Error']]);
    expect(f.runs).toEqual([]);
    expect(f.routine.nextRunAt).toBe(boot);
    await vi.advanceTimersByTimeAsync(299_999);
    expect(claim).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(1001);
    expect(claim).toHaveBeenCalledTimes(7);
    expect(f.runs).toMatchObject([{ routineId: 'r', trigger: 'scheduled', slotAt: boot }]);
    expect(f.start).toHaveBeenCalledOnce();
  } finally { f.service.stop({}); }
});

it('restarts slot reconciliation after quiescing without claiming the still-owned lease again', async () => {
  const f = fixture();
  f.service.start({});
  try {
    await f.service.whenReady();
    expect(f.service.nextRunAt({ routineId: 'r' })?.getTime()).toBe(boot + hour);
    f.service.quiesce();
    expect(f.service.nextRunAt({ routineId: 'r' })).toBeNull();
    expect(f.service.leaseState()).toBe('owner');
    f.service.start({}, { reason: 'enable' });
    expect(f.service.nextRunAt({ routineId: 'r' })?.getTime()).toBe(boot + hour);
    expect(f.persistence.acquireLease).toHaveBeenCalledExactlyOnceWith({ holderId: 'a', now: boot, ttlMs: 90_000 }, {});
  } finally { f.service.stop({}); }
});

it('fences an expired owner on wake if another holder has already acquired its lease', async () => {
  const f = fixture();
  f.routine.nextRunAt = boot + 10_000;
  f.service.start({});
  try {
    await f.service.whenReady();
    vi.setSystemTime(boot + 90_001);
    expect(f.persistence.acquireLease({ holderId: 'peer', now: Date.now(), ttlMs: 90_000 }, {})).toBe(true);
    await f.service.reconcile({ reason: 'wake' });
    expect(f.service.leaseState()).toBe('passive');
    expect(f.service.nextRunAt({ routineId: 'r' })).toBeNull();
    expect(f.log.mock.calls).toEqual([['ROUTINES_LEASE_LOST', { holderId: 'a' }]]);
    expect(f.routine.nextRunAt).toBe(boot + 10_000);
    expect(f.handler).not.toHaveBeenCalled();
    expect(f.runs).toEqual([]);
  } finally { f.service.stop({}); }
});

it('uses the persisted winner’s slot when seeding loses a compare-and-set race', async () => {
  const f = fixture();
  f.routine.nextRunAt = null;
  const winner = boot + 2 * hour;
  const setNextRunAt = vi.spyOn(f.persistence, 'setNextRunAt').mockImplementationOnce(() => {
    f.routine.nextRunAt = winner;
    return false;
  });
  f.service.start({});
  try {
    await f.service.whenReady();
    expect(setNextRunAt.mock.calls).toEqual([[{
      routineId: 'r', expected: null, nextRunAt: boot + hour, holderId: 'a', now: boot,
    }, {}]]);
    expect(f.service.nextRunAt({ routineId: 'r' })?.getTime()).toBe(winner);
    expect(f.handler).not.toHaveBeenCalled();
  } finally { f.service.stop({}); }
});

it('reports an ordinary run-handler failure without treating it as a persistence retry', async () => {
  const f = fixture();
  f.routine.nextRunAt = boot;
  f.handler.mockRejectedValueOnce(new TypeError('preparation failed'));
  f.service.start({});
  try {
    await f.service.whenReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.log.mock.calls).toEqual([['ROUTINE_RUN_FAILED', 'TypeError']]);
    expect(f.persistence.claimDueSlot).not.toHaveBeenCalled();
    expect(f.runs).toEqual([]);
    // A subsequent edit, rather than a persistence retry, may replace this slot.
    f.routine.nextRunAt = boot + hour;
    f.service.rescheduleOne({ routineId: 'r' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.handler).toHaveBeenCalledOnce();
    expect(f.service.nextRunAt({ routineId: 'r' })?.getTime()).toBe(boot + hour);
  } finally { f.service.stop({}); }
});
