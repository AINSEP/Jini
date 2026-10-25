import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoutineService } from '../scheduler.js';
import type { Routine, RoutinePersistence } from '../types.js';

// F1 fix wave (Stryker L8 §4 routines/scheduler.ts:109,131,135,150): started/idempotent guards,
// existing-timer replacement, and the `now` handed to the schedule calculation.
const NOW = Date.UTC(2026, 0, 1, 10, 0, 0);
function routine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: 'r1', name: 'n', prompt: 'p', schedule: { kind: 'hourly', minute: 30 }, target: { mode: 'create_each_run' },
    skillId: null, agentId: null, context: {}, enabled: true, nextRunAt: null, lastRun: null, createdAt: NOW, updatedAt: NOW, ...overrides,
  } as Routine;
}
function service(routines: Routine[]) {
  const persistence: RoutinePersistence = { list: vi.fn(() => routines), insertRun: vi.fn(() => true), updateRun: vi.fn(), getLatestRun: vi.fn(() => null) };
  return { svc: new RoutineService({ persistence }, { now: () => NOW }), persistence };
}

describe('RoutineService — F1 lifecycle guards', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('before start() nothing is scheduled, even via rescheduleAll / rescheduleOne', () => {
    const { svc, persistence } = service([routine()]);
    svc.rescheduleAll({});
    svc.rescheduleOne({ routineId: 'r1' });
    expect(svc.nextRunAt({ routineId: 'r1' })).toBeNull();
    expect(persistence.list).not.toHaveBeenCalled();
  });

  it('start() schedules from the injected clock (hourly :30 after 10:00 → 10:30) and is idempotent', () => {
    vi.useFakeTimers({ now: NOW });
    const { svc, persistence } = service([routine()]);
    svc.start({});
    svc.start({});
    expect(svc.nextRunAt({ routineId: 'r1' })?.getTime()).toBe(Date.UTC(2026, 0, 1, 10, 30));
    expect(persistence.list).toHaveBeenCalledTimes(1);
    svc.stop({});
  });

  it('stop() clears every timer and a later rescheduleOne does not re-arm', () => {
    vi.useFakeTimers({ now: NOW });
    const { svc } = service([routine(), routine({ id: 'r2' })]);
    svc.start({});
    svc.stop({});
    expect([svc.nextRunAt({ routineId: 'r1' }), svc.nextRunAt({ routineId: 'r2' })]).toEqual([null, null]);
    svc.rescheduleOne({ routineId: 'r1' });
    expect(svc.nextRunAt({ routineId: 'r1' })).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rescheduleOne replaces (not duplicates) an existing timer', () => {
    vi.useFakeTimers({ now: NOW });
    const { svc } = service([routine()]);
    svc.start({});
    expect(vi.getTimerCount()).toBe(1);
    svc.rescheduleOne({ routineId: 'r1' });
    svc.rescheduleOne({ routineId: 'r1' });
    expect(vi.getTimerCount()).toBe(1);
    svc.stop({});
  });

  it('a disabled routine and an unknown id are never scheduled; unschedule removes only its own timer', () => {
    vi.useFakeTimers({ now: NOW });
    const { svc } = service([routine({ enabled: false }), routine({ id: 'r2' }), routine({ id: 'r3' })]);
    svc.start({});
    expect(svc.nextRunAt({ routineId: 'r1' })).toBeNull();
    svc.rescheduleOne({ routineId: 'ghost' });
    expect(vi.getTimerCount()).toBe(2);
    svc.unschedule({ routineId: 'r2' });
    expect([svc.nextRunAt({ routineId: 'r2' }), svc.nextRunAt({ routineId: 'r3' }) !== null]).toEqual([null, true]);
    expect(vi.getTimerCount()).toBe(1);
    svc.stop({});
  });

  it('a schedule with no next instant (unknown kind) arms no timer', () => {
    vi.useFakeTimers({ now: NOW });
    const { svc } = service([routine({ schedule: { kind: 'monthly' } as never })]);
    svc.start({});
    expect(vi.getTimerCount()).toBe(0);
    svc.stop({});
  });
});

// F1 re-score kills (routines/scheduler.ts:226,258-265,289,322-323).
describe('RoutineService.runNow — F1 persistence of prepared ids and completions', () => {
  function manual(handler: Parameters<RoutineService['setRunHandler']>[0]['handler'], insertRun: RoutinePersistence['insertRun'] = vi.fn(() => true)) {
    const persistence: RoutinePersistence = { list: () => [routine()], insertRun, updateRun: vi.fn(), getLatestRun: () => null };
    const svc = new RoutineService({ persistence }, { now: () => NOW, newId: () => 'id' });
    svc.setRunHandler({ handler });
    return { svc, persistence };
  }
  const base = () => ({ projectId: 'p', conversationId: 'c', agentRunId: 'a', completion: new Promise<never>(() => undefined) });
  const idPatches = (updateRun: unknown) => (updateRun as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).filter((u: { patch: Record<string, unknown> }) => 'projectId' in u.patch && !('status' in u.patch));

  it('a manual run whose prepare() changes nothing writes NO id patch', async () => {
    const { svc, persistence } = manual(async () => ({ ...base(), prepare: () => undefined }));
    await svc.runNow({ routineId: 'r1' });
    expect(idPatches(persistence.updateRun)).toEqual([]);
  });

  it.each(['projectId', 'conversationId', 'agentRunId'] as const)('a manual run whose prepare() changes only %s persists all three ids and copies them onto the handle', async (field) => {
    const start = { ...base(), prepare: (run: Record<string, string>) => { run[field] = `${field}-real`; } };
    const { svc, persistence } = manual(async () => start as never);
    const handle = await svc.runNow({ routineId: 'r1' });
    const expected = { projectId: 'p', conversationId: 'c', agentRunId: 'a', [field]: `${field}-real` };
    expect(idPatches(persistence.updateRun)).toEqual([{ id: 'routine-run-id', patch: expected }]);
    expect({ projectId: handle.projectId, conversationId: handle.conversationId, agentRunId: handle.agentRunId }).toEqual(expected);
  });

  it('a lost slot (insertRun false) prefers discardUnstarted over discard', async () => {
    const discard = vi.fn(); const discardUnstarted = vi.fn();
    const { svc } = manual(async () => ({ ...base(), discard, discardUnstarted }), vi.fn(() => false));
    await svc.runNow({ routineId: 'r1' });
    expect(discardUnstarted).toHaveBeenCalledTimes(1);
    expect(discard).not.toHaveBeenCalled();
  });

  it('a lost slot with neither callback is tolerated; with only discard, discard is used', async () => {
    await expect(manual(async () => base(), vi.fn(() => false)).svc.runNow({ routineId: 'r1' })).resolves.toBeDefined();
    const discard = vi.fn();
    await manual(async () => ({ ...base(), discard }), vi.fn(() => false)).svc.runNow({ routineId: 'r1' });
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it('a failing prepare() without a discard callback still finalizes the row as failed', async () => {
    const { svc, persistence } = manual(async () => ({ ...base(), prepare: () => { throw new Error('prep'); } }));
    await expect(svc.runNow({ routineId: 'r1' })).rejects.toThrow('prep');
    const failed = (persistence.updateRun as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).find((u: { patch: { status?: string } }) => u.patch.status === 'failed');
    expect(failed.patch).toMatchObject({ status: 'failed', error: 'prep', errorCode: null, summary: null, completedAt: NOW });
  });

  it('completion fields absent → persisted as null; present → persisted verbatim', async () => {
    let resolve!: (c: unknown) => void;
    const completion = new Promise((r) => { resolve = r; });
    const { svc, persistence } = manual(async () => ({ ...base(), completion: completion as never }));
    await svc.runNow({ routineId: 'r1' });
    resolve({ status: 'succeeded' });
    await completion; await Promise.resolve();
    const done = (persistence.updateRun as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).find((u: { patch: { status?: string } }) => u.patch.status === 'succeeded');
    expect(done.patch).toEqual({ status: 'succeeded', completedAt: NOW, summary: null, error: null, errorCode: null });
    let resolve2!: (c: unknown) => void;
    const completion2 = new Promise((r) => { resolve2 = r; });
    const m2 = manual(async () => ({ ...base(), completion: completion2 as never }));
    await m2.svc.runNow({ routineId: 'r1' });
    resolve2({ status: 'failed', summary: 's', error: 'e', errorCode: 'E1' });
    await completion2; await Promise.resolve();
    const done2 = (m2.persistence.updateRun as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).find((u: { patch: { status?: string } }) => u.patch.status === 'failed');
    expect(done2.patch).toEqual({ status: 'failed', completedAt: NOW, summary: 's', error: 'e', errorCode: 'E1' });
  });
});
