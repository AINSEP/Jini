import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import { createDeadlineSignal } from '../fetch-with-timeout.js';

describe('createDeadlineSignal', () => {
  beforeEach(() => {
    // Native timeout signals use internal timers; exercise the cancellable default
    // wait through fake global timers, keeping real AbortSignals and abort reasons.
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uses the full wait budget when options are omitted', async () => {
    const { signal } = createDeadlineSignal({ waitMs: 100 });
    await vi.advanceTimersByTimeAsync(99);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
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
  ])('expires after $remaining ms for wait=$waitMs, start=$startedAt, now=$now', async ({ waitMs, startedAt, now, remaining }) => {
    const { signal } = createDeadlineSignal({ waitMs }, { startedAt, now: () => now });
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(Math.max(0, remaining - 1));
    if (remaining > 0) expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(Math.min(1, remaining));
    expect(signal.aborted).toBe(true);
    expect(signal.reason.name).toBe('TimeoutError');
  });

  it('uses the current time when only startedAt is supplied', async () => {
    const { signal } = createDeadlineSignal({ waitMs: 100 }, { startedAt: 975 });
    await vi.advanceTimersByTimeAsync(74);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
  });

  it('does not read the clock without a start time', async () => {
    const now = vi.fn(() => { throw new Error('clock must not be read'); });
    const { signal } = createDeadlineSignal({ waitMs: 10 }, { now });
    await vi.advanceTimersByTimeAsync(10);
    expect(signal.aborted).toBe(true);
    expect(now).not.toHaveBeenCalled();
  });

  it('propagates caller cancellation and its reason before the deadline', async () => {
    const caller = new AbortController();
    const { signal } = createDeadlineSignal({ waitMs: 100 }, { signal: caller.signal });
    expect(signal.aborted).toBe(false);
    const reason = new Error('caller cancelled');
    caller.abort(reason);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
    await vi.advanceTimersByTimeAsync(100);
    expect(signal.reason).toBe(reason);
  });

  it('honors an already-aborted caller immediately', () => {
    const reason = new Error('already cancelled');
    const { signal } = createDeadlineSignal({ waitMs: 100 }, { signal: AbortSignal.abort(reason) });
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
  });

  it('still enforces the remaining deadline when a caller signal is supplied', async () => {
    const caller = new AbortController();
    const { signal } = createDeadlineSignal({ waitMs: 100 }, {
      signal: caller.signal, startedAt: 975, now: () => 1_000,
    });
    await vi.advanceTimersByTimeAsync(74);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    expect(signal.reason.name).toBe('TimeoutError');
    expect(caller.signal.aborted).toBe(false);
    caller.abort(new Error('later cancellation'));
    expect(signal.reason.name).toBe('TimeoutError');
  });

  it('keeps concurrent calls independent without mutating their input objects', async () => {
    const input = Object.freeze({ waitMs: 100 });
    const options = Object.freeze({ startedAt: 950, now: () => 1_000 });
    const { signal: earlier } = createDeadlineSignal(input, options);
    const { signal: later } = createDeadlineSignal(input);
    await vi.advanceTimersByTimeAsync(50);
    expect(earlier.aborted).toBe(true);
    expect(later.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(later.aborted).toBe(true);
  });

  it('never grants spent time again across nonnegative integer budgets', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 0, max: 1_000 }),
      fc.integer({ min: 0, max: 1_000 }),
      async (waitMs, elapsed) => {
        const { signal } = createDeadlineSignal({ waitMs }, { startedAt: 0, now: () => elapsed });
        const remaining = elapsed >= waitMs ? 0 : waitMs - elapsed;
        if (remaining > 0) {
          await vi.advanceTimersByTimeAsync(remaining - 1);
          expect(signal.aborted).toBe(false);
          await vi.advanceTimersByTimeAsync(1);
        } else {
          await vi.advanceTimersByTimeAsync(0);
        }
        expect(signal.aborted).toBe(true);
        expect(signal.reason.name).toBe('TimeoutError');
      },
    ), { seed: 20261028, numRuns: 100 });
  });
});

describe('createDeadlineSignal default wait', () => {
  it('returns a deadline signal with the native timeout reason', async () => {
    vi.useFakeTimers();
    try {
      const { signal } = createDeadlineSignal({ waitMs: 1 });
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBeInstanceOf(DOMException);
      expect(signal.reason.name).toBe('TimeoutError');
    } finally { vi.useRealTimers(); }
  });

  // Guards clearTimeout(timer) in the real wait adapter, independently of the injected fake.
  it('dispose cancels the default timer without aborting the returned signal', async () => {
    vi.useFakeTimers();
    try {
      const { signal, dispose } = createDeadlineSignal({ waitMs: 25_000 });
      expect(vi.getTimerCount()).toBe(1);
      dispose();
      dispose();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(25_000);
      expect(signal.aborted).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it.each([NaN, Infinity, 1.5])('preserves native rejection of an invalid timeout: %s', waitMs => {
    expect(() => createDeadlineSignal({ waitMs })).toThrow(RangeError);
  });
});
