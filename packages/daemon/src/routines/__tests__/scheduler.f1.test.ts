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
