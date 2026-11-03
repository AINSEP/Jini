import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '@jini-ai/core/primitives';
import { createIdleMonitor } from '../idle-monitor.js';
import type { SchedulerPort } from '../scheduler.js';

/** Drives the injected timer port in deadline order without allocating native timers. */
function createFakeTime() {
  let now = 40_000;
  const pending = new Set<{ due: number; callback: () => void }>();
  const clock: Clock = { nowMs: () => now };
  const schedule = vi.fn<SchedulerPort['schedule']>(({ delayMs, callback }) => {
    const timer = { due: now + delayMs, callback };
    pending.add(timer);
    return vi.fn(() => { pending.delete(timer); });
  });
  return {
    clock,
    scheduler: { schedule },
    pendingCount: () => pending.size,
    advance({ ms }: { ms: number }) {
      const target = now + ms;
      let next = [...pending].sort((a, b) => a.due - b.due)[0];
      while (next && next.due <= target) {
        now = next.due;
        pending.delete(next);
        next.callback();
        next = [...pending].sort((a, b) => a.due - b.due)[0];
      }
      now = target;
    },
  };
}

describe('createIdleMonitor', () => {
  it.each([0, -1, NaN, Infinity])('rejects invalid idle interval %s before scheduling', (idleMs) => {
    const time = createFakeTime();
    expect(() => createIdleMonitor({ ...time, isBusy: () => false, idleMs }, { onIdle: vi.fn() }))
      .toThrow(RangeError);
    expect(time.pendingCount()).toBe(0);
  });

  it('fires once after uninterrupted idle', () => {
    const time = createFakeTime();
    const onIdle = vi.fn();
    const monitor = createIdleMonitor({ ...time, isBusy: () => false, idleMs: 2_500 }, { onIdle });

    time.advance({ ms: 2_499 });
    expect(onIdle).not.toHaveBeenCalled();
    time.advance({ ms: 1 });
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(time.pendingCount()).toBe(0);
    time.advance({ ms: 10_000 });
    monitor.stop();
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(time.pendingCount()).toBe(0);
  });

  it('busy observation resets the interval', () => {
    const time = createFakeTime();
    const onIdle = vi.fn();
    let busy = false;
    createIdleMonitor({ ...time, isBusy: () => busy, idleMs: 3_000 }, { onIdle });

    time.advance({ ms: 1_000 });
    busy = true;
    time.advance({ ms: 4_000 });
    expect(onIdle).not.toHaveBeenCalled();
    busy = false;
    time.advance({ ms: 1_000 }); // First idle observation starts a fresh interval.
    time.advance({ ms: 2_999 });
    expect(onIdle).not.toHaveBeenCalled();
    time.advance({ ms: 1 });
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(time.pendingCount()).toBe(0);
  });

  it('stop cancels pending work', () => {
    const time = createFakeTime();
    const onIdle = vi.fn();
    const monitor = createIdleMonitor({ ...time, isBusy: () => false, idleMs: 3_000 }, { onIdle });

    time.advance({ ms: 1_000 });
    expect(time.pendingCount()).toBe(1);
    monitor.stop();
    monitor.stop();
    expect(time.pendingCount()).toBe(0);
    time.advance({ ms: 10_000 });
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('late callbacks after stop do nothing', () => {
    const time = createFakeTime();
    const onIdle = vi.fn();
    const isBusy = vi.fn(() => false);
    const monitor = createIdleMonitor({ ...time, isBusy, idleMs: 3_000 }, { onIdle });
    const queued = time.scheduler.schedule.mock.calls[0];
    if (!queued) throw new Error('The monitor must schedule an observation');

    monitor.stop();
    const observations = isBusy.mock.calls.length;
    time.advance({ ms: 10_000 });
    queued[0].callback(); // Simulate a callback already queued when cancellation occurred.
    queued[0].callback();
    expect(isBusy).toHaveBeenCalledTimes(observations);
    expect(onIdle).not.toHaveBeenCalled();
    expect(time.pendingCount()).toBe(0);
  });

  it('starts the idle interval only after initially busy work ends', () => {
    const time = createFakeTime();
    const onIdle = vi.fn();
    let busy = true;
    createIdleMonitor({ ...time, isBusy: () => busy, idleMs: 3_000 }, { onIdle });

    time.advance({ ms: 10_000 });
    expect(onIdle).not.toHaveBeenCalled();
    busy = false;
    time.advance({ ms: 3_999 });
    expect(onIdle).not.toHaveBeenCalled();
    time.advance({ ms: 1 });
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(time.pendingCount()).toBe(0);
  });
});
