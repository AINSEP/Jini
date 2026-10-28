import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import { createDeadlineSignal } from '../fetch-with-timeout.js';

describe('createDeadlineSignal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    // Native timeout signals use internal timers; replace only their scheduling,
    // keeping real AbortSignals and AbortSignal.any cancellation semantics.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('deadline elapsed', 'TimeoutError')), ms);
      return controller.signal;
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uses the full wait budget when options are omitted', () => {
    const signal = createDeadlineSignal({ waitMs: 100 });
    vi.advanceTimersByTime(99);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    expect(signal.reason.name).toBe('TimeoutError');
  });

  it.each([
    { waitMs: 100, startedAt: 0, now: 25, remaining: 75 },
    { waitMs: 100, startedAt: 1_000, now: 1_000, remaining: 100 },
    { waitMs: 100, startedAt: 1_000, now: 1_100, remaining: 0 },
    { waitMs: 100, startedAt: 1_000, now: 1_200, remaining: 0 },
    { waitMs: 100, startedAt: 1_100, now: 1_000, remaining: 100 },
    { waitMs: 0, startedAt: 1_000, now: 1_000, remaining: 0 },
    { waitMs: -10, startedAt: 1_000, now: 1_000, remaining: 0 },
  ])('expires after $remaining ms for wait=$waitMs, start=$startedAt, now=$now', ({ waitMs, startedAt, now, remaining }) => {
    const signal = createDeadlineSignal({ waitMs }, { startedAt, now: () => now });
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(Math.max(0, remaining - 1));
    if (remaining > 0) expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(Math.min(1, remaining));
    expect(signal.aborted).toBe(true);
    expect(signal.reason.name).toBe('TimeoutError');
  });

  it('uses the current time when only startedAt is supplied', () => {
    const signal = createDeadlineSignal({ waitMs: 100 }, { startedAt: 975 });
    vi.advanceTimersByTime(74);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
  });

  it('does not read the clock without a start time', () => {
    const now = vi.fn(() => { throw new Error('clock must not be read'); });
    const signal = createDeadlineSignal({ waitMs: 10 }, { now });
    vi.advanceTimersByTime(10);
    expect(signal.aborted).toBe(true);
    expect(now).not.toHaveBeenCalled();
  });

  it('propagates caller cancellation and its reason before the deadline', () => {
    const caller = new AbortController();
    const signal = createDeadlineSignal({ waitMs: 100 }, { signal: caller.signal });
    expect(signal.aborted).toBe(false);
    const reason = new Error('caller cancelled');
    caller.abort(reason);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
    vi.advanceTimersByTime(100);
    expect(signal.reason).toBe(reason);
  });

  it('honors an already-aborted caller immediately', () => {
    const reason = new Error('already cancelled');
    const signal = createDeadlineSignal({ waitMs: 100 }, { signal: AbortSignal.abort(reason) });
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
  });

  it('still enforces the remaining deadline when a caller signal is supplied', () => {
    const caller = new AbortController();
    const signal = createDeadlineSignal({ waitMs: 100 }, {
      signal: caller.signal, startedAt: 975, now: () => 1_000,
    });
    vi.advanceTimersByTime(74);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    expect(signal.reason.name).toBe('TimeoutError');
    expect(caller.signal.aborted).toBe(false);
    caller.abort(new Error('later cancellation'));
    expect(signal.reason.name).toBe('TimeoutError');
  });

  it('keeps concurrent calls independent without mutating their input objects', () => {
    const input = Object.freeze({ waitMs: 100 });
    const options = Object.freeze({ startedAt: 950, now: () => 1_000 });
    const earlier = createDeadlineSignal(input, options);
    const later = createDeadlineSignal(input);
    vi.advanceTimersByTime(50);
    expect(earlier.aborted).toBe(true);
    expect(later.aborted).toBe(false);
    vi.advanceTimersByTime(50);
    expect(later.aborted).toBe(true);
  });

  it('never grants spent time again across nonnegative integer budgets', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 1_000 }),
      fc.integer({ min: 0, max: 1_000 }),
      (waitMs, elapsed) => {
        const signal = createDeadlineSignal({ waitMs }, { startedAt: 0, now: () => elapsed });
        const remaining = elapsed >= waitMs ? 0 : waitMs - elapsed;
        if (remaining > 0) {
          vi.advanceTimersByTime(remaining - 1);
          expect(signal.aborted).toBe(false);
          vi.advanceTimersByTime(1);
        } else {
          vi.advanceTimersByTime(0);
        }
        expect(signal.aborted).toBe(true);
        expect(signal.reason.name).toBe('TimeoutError');
      },
    ), { seed: 20261028, numRuns: 100 });
  });
});

describe('createDeadlineSignal with native timeout signals', () => {
  it('returns a native timeout signal with the native timeout reason', async () => {
    const signal = createDeadlineSignal({ waitMs: 1 });
    expect(signal.aborted).toBe(false);
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(DOMException);
    expect(signal.reason.name).toBe('TimeoutError');
  });

  it.each([NaN, Infinity, 1.5])('preserves native rejection of an invalid timeout: %s', waitMs => {
    expect(() => createDeadlineSignal({ waitMs })).toThrow(RangeError);
  });
});
