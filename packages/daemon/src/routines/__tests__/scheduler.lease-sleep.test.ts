import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoutineService } from '../scheduler.js';
import type { Routine, RoutineDurablePersistence, RoutineRun, RoutineRunHandlerStart } from '../types.js';

/**
 * @file Two processes (two Tovu windows / profiles) share one routine sidecar on a laptop that sleeps
 * longer than the 90 s lease TTL. Vitest's `setSystemTime` moves wall time without firing timers,
 * which is exactly a suspend: Node timers run on monotonic time, so each one keeps its remaining delay.
 * The injected monotonic clock is wall time minus the total time slept.
 */
const ttl = 90_000;
const boot = Date.UTC(2026, 10, 25, 12);

function world() {
  vi.useFakeTimers();
  vi.setSystemTime(boot);
  let slept = 0;
  const monotonicNow = () => Date.now() - boot - slept;
  const routine: Routine = { id: 'r', name: 'Brief', prompt: 'Brief', schedule: { kind: 'hourly', minute: 0 },
    target: { mode: 'create_each_run' }, skillId: null, agentId: null, context: {}, enabled: true,
    nextRunAt: boot + 5_000, lastRun: null, createdAt: 1, updatedAt: 1, revision: 1, creatorId: 'owner', model: null };
  const runs: RoutineRun[] = [];
  const lease = { holder: '', expiry: 0 };
  const persistence: RoutineDurablePersistence = {
    list: () => [routine],
    insertRun: () => false,
    updateRun: ({ id, patch }) => { const row = runs.find((r) => r.id === id); if (row) Object.assign(row, patch); },
    getLatestRun: () => runs.at(-1) ?? null,
    claimDueSlot: ({ expectedNextRunAt, nextRunAt, run, holderId, now }) => {
      if (lease.holder !== holderId || lease.expiry <= now) return { claimed: false, reason: 'lease-lost' };
      if (routine.nextRunAt !== expectedNextRunAt) return { claimed: false, reason: 'slot-moved' };
      routine.nextRunAt = nextRunAt;
      if (runs.some((r) => r.status === 'running')) return { claimed: false, reason: 'active-run' };
      runs.push({ ...run }); return { claimed: true };
    },
    setNextRunAt: ({ expected, nextRunAt }) => { if (routine.nextRunAt !== expected) return false; routine.nextRunAt = nextRunAt; return true; },
    listInFlight: ({ excludeHolderId } = {}) => runs.filter((r) => r.status === 'running' && r.holderId !== excludeHolderId),
    markInterrupted: vi.fn<RoutineDurablePersistence['markInterrupted']>(({ runIds }) => {
      for (const r of runs) if (runIds.includes(r.id)) r.status = 'interrupted';
    }),
    acquireLease: ({ holderId, now, ttlMs }) => {
      if (lease.holder && lease.holder !== holderId && lease.expiry > now) return false;
      lease.holder = holderId; lease.expiry = now + ttlMs; return true;
    },
    releaseLease: ({ holderId }) => { if (lease.holder === holderId) { lease.holder = ''; lease.expiry = 0; } },
  };
  const service = (holderId: string) => {
    const onInterrupted = vi.fn(async () => {});
    const handler = vi.fn(async (): Promise<RoutineRunHandlerStart> => ({ projectId: '', conversationId: `c-${holderId}`,
      agentRunId: '', assistantMessageId: `m-${holderId}`, completion: new Promise(() => {}),
      prepare: vi.fn(), start: vi.fn(), discardUnstarted: vi.fn() }));
    let id = 0;
    const svc = new RoutineService({ persistence }, { holderId, now: Date.now, monotonicNow, newId: () => `${holderId}${++id}`,
      leaseTtlMs: ttl, log: vi.fn(), onInterrupted });
    svc.setRunHandler({ handler });
    return { svc, handler, onInterrupted };
  };
  const sleep = (ms: number) => { slept += ms; vi.setSystemTime(Date.now() + ms); };
  return { routine, runs, lease, persistence, service, sleep };
}

afterEach(() => { vi.useRealTimers(); });

describe('sleep past the lease TTL', () => {
  async function ownerRunningAndPassivePeer() {
    const w = world();
    const owner = w.service('owner');
    owner.svc.start({}); await owner.svc.whenReady({}, {});
    await vi.advanceTimersByTimeAsync(5_000); // owner fires the 12:00:05 slot; the run stays live
    expect(w.runs).toMatchObject([{ holderId: 'owner', status: 'running' }]);
    await vi.advanceTimersByTimeAsync(24_000); // t = 29 s
    const peer = w.service('peer');
    peer.svc.start({}); // retry due at t = 119 s; owner heartbeats at 30, 60, 90, 120 s
    expect(peer.svc.leaseState({}, {})).toBe('passive');
    await vi.advanceTimersByTimeAsync(71_000); // t = 100 s: owner's next heartbeat in 20 s, peer's retry in 19 s
    return { w, owner, peer };
  }

  it("sleep past the 90 s TTL does not let a waking passive peer interrupt the owner's live run", async () => {
    const { w, owner, peer } = await ownerRunningAndPassivePeer();
    w.sleep(10 * 60_000);
    expect(w.lease.expiry).toBeLessThan(Date.now()); // on wall time, the owner's lease looks dead
    await vi.advanceTimersByTimeAsync(19_000); // the passive peer's timer wins the first wake turn
    await vi.advanceTimersByTimeAsync(ttl + 1_000); // owner renews at +20 s; peer retries again
    expect(w.lease.holder).toBe('owner');
    expect(peer.svc.leaseState({}, {})).toBe('passive');
    expect(owner.svc.leaseState({}, {})).toBe('owner');
    expect(w.persistence.markInterrupted).not.toHaveBeenCalledWith(expect.objectContaining({ holderId: 'peer' }), expect.anything());
    expect(peer.onInterrupted).not.toHaveBeenCalled();
    expect(peer.handler).not.toHaveBeenCalled();
    expect(w.runs).toMatchObject([{ holderId: 'owner', status: 'running' }]);
    owner.svc.stop({}); peer.svc.stop({});
  });

  it('a dead owner is still taken over after one awake TTL, and its run is recorded Interrupted', async () => {
    const { w, owner, peer } = await ownerRunningAndPassivePeer();
    owner.svc.stop({}, { releaseLease: false }); // the owner process dies holding the lease
    w.sleep(10 * 60_000);
    await vi.advanceTimersByTimeAsync(19_000);
    expect(peer.svc.leaseState({}, {})).toBe('passive'); // first wake turn only defers
    await vi.advanceTimersByTimeAsync(ttl);
    expect(peer.svc.leaseState({}, {})).toBe('owner');
    expect(w.runs[0]).toMatchObject({ holderId: 'owner', status: 'interrupted' });
    expect(peer.onInterrupted).toHaveBeenCalledWith({ runs: [expect.objectContaining({ id: w.runs[0]!.id })] }, {});
    peer.svc.stop({});
  });

  it('the owner renews on a wake reconcile before claiming, so its own slot still fires after sleep', async () => {
    const { w, owner, peer } = await ownerRunningAndPassivePeer();
    w.runs[0]!.status = 'succeeded';
    w.routine.nextRunAt = Date.now() + 30_000;
    owner.svc.rescheduleOne({ routineId: 'r' }, {});
    w.sleep(10 * 60_000);
    await owner.svc.reconcile({ reason: 'wake' }, {}); // the main-process wake relay reaches the owner first
    expect(w.lease).toMatchObject({ holder: 'owner' });
    expect(w.lease.expiry).toBeGreaterThan(Date.now());
    expect(w.runs.filter((r) => r.status === 'running')).toMatchObject([{ holderId: 'owner', catchUp: true }]);
    owner.svc.stop({}); peer.svc.stop({});
  });
});
