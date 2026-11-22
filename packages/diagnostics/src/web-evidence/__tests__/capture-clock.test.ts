import { afterEach, describe, expect, it, vi } from 'vitest';
import { REAL_CAPTURE_CLOCK } from '../capture-clock.js';

describe('REAL_CAPTURE_CLOCK', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('reads the platform clock and timers at call time, so a fake-timer setup still drives it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_234);
    expect(REAL_CAPTURE_CLOCK.now()).toBe(1_234);
    const fired: number[] = [];
    REAL_CAPTURE_CLOCK.setTimeout(() => fired.push(REAL_CAPTURE_CLOCK.now()), 100);
    const cleared = REAL_CAPTURE_CLOCK.setTimeout(() => fired.push(-1), 50);
    REAL_CAPTURE_CLOCK.clearTimeout(cleared);
    vi.advanceTimersByTime(100);
    expect(fired).toEqual([1_334]);
  });

  it('hands out a signal that aborts with the platform TimeoutError after the given time', async () => {
    const signal = REAL_CAPTURE_CLOCK.deadlineSignal(5);
    expect(signal.aborted).toBe(false);
    await new Promise<void>(resolve => { signal.addEventListener('abort', () => resolve(), { once: true }); });
    expect((signal.reason as Error).name).toBe('TimeoutError');
  });
});
