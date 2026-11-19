import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyRunCloseStatus, createInactivityWatchdog, resolveTimeoutMs } from '../close-status.js';

describe('classifyRunCloseStatus', () => {
  it('classifies cancellation ahead of exit code, even when the code looks successful', () => {
    expect(classifyRunCloseStatus({ cancelRequested: true, code: 0 })).toBe('cancelled');
    expect(classifyRunCloseStatus({ cancelRequested: true, code: 1 }, { signal: 'SIGTERM' })).toBe('cancelled');
  });

  it('classifies exit code 0 (no cancellation) as succeeded', () => {
    expect(classifyRunCloseStatus({ cancelRequested: false, code: 0 })).toBe('succeeded');
  });

  it('classifies any non-zero or null exit code (no cancellation) as failed', () => {
    expect(classifyRunCloseStatus({ cancelRequested: false, code: 1 })).toBe('failed');
    expect(classifyRunCloseStatus({ cancelRequested: false, code: null }, { signal: 'SIGKILL' })).toBe('failed');
  });
});

describe('resolveTimeoutMs', () => {
  it('prefers a valid configured timeout over the agent default and kernel default', () => {
    const ms = resolveTimeoutMs({ defaultMs: 1_000, maxMs: 100_000 }, { configuredTimeoutMs: '20000', agentDefaultMs: 5_000 });
    expect(ms).toBe(20_000);
  });

  it('falls back to the agent default when the configured timeout is absent', () => {
    const ms = resolveTimeoutMs({ defaultMs: 1_000, maxMs: 100_000 }, { configuredTimeoutMs: undefined, agentDefaultMs: 5_000 });
    expect(ms).toBe(5_000);
  });

  it('falls back to the kernel default when neither configured timeout nor agent default is set', () => {
    const ms = resolveTimeoutMs({ defaultMs: 1_000, maxMs: 100_000 }, { configuredTimeoutMs: undefined });
    expect(ms).toBe(1_000);
  });

  it('treats a non-numeric or non-positive configured value as absent rather than throwing', () => {
    expect(resolveTimeoutMs({ defaultMs: 1_000, maxMs: 100_000 }, { configuredTimeoutMs: 'nope', agentDefaultMs: 5_000 })).toBe(5_000);
    expect(resolveTimeoutMs({ defaultMs: 1_000, maxMs: 100_000 }, { configuredTimeoutMs: '-5', agentDefaultMs: 5_000 })).toBe(5_000);
    expect(resolveTimeoutMs({ defaultMs: 1_000, maxMs: 100_000 }, { configuredTimeoutMs: '0', agentDefaultMs: 5_000 })).toBe(5_000);
  });

  it('clamps the resolved value to maxMs regardless of source', () => {
    expect(resolveTimeoutMs({ defaultMs: 1_000, maxMs: 2_000 }, { configuredTimeoutMs: '999999' })).toBe(2_000);
  });

  it('uses the agent default when the configured timeout is undefined', () => {
    // The host has no configured timeout value to supply.
    const ms = resolveTimeoutMs({ defaultMs: 1_000, maxMs: 100_000 }, { configuredTimeoutMs: undefined, agentDefaultMs: 5_000 });
    expect(ms).toBe(5_000);
  });

  it('uses the agent default with no configured timeout when global process is unavailable', () => {
    // Timeout resolution uses only the supplied scalar values in a non-Node host too.
    vi.stubGlobal('process', undefined);
    try {
      const ms = resolveTimeoutMs({ defaultMs: 1_000, maxMs: 100_000 }, { configuredTimeoutMs: undefined, agentDefaultMs: 5_000 });
      expect(ms).toBe(5_000);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('createInactivityWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onTimeout once after timeoutMs of no activity', () => {
    const onTimeout = vi.fn();
    createInactivityWatchdog({ timeoutMs: 1_000, onTimeout });
    vi.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('noteActivity() resets the window so onTimeout only fires timeoutMs after the LAST activity', () => {
    const onTimeout = vi.fn();
    const watchdog = createInactivityWatchdog({ timeoutMs: 1_000, onTimeout });
    vi.advanceTimersByTime(700);
    watchdog.noteActivity({});
    vi.advanceTimersByTime(700);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('cancel() permanently disarms the watchdog', () => {
    const onTimeout = vi.fn();
    const watchdog = createInactivityWatchdog({ timeoutMs: 1_000, onTimeout });
    watchdog.cancel({});
    vi.advanceTimersByTime(10_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

it('takes raw timeout text before agent defaults and clamps that value', () => {
  expect(resolveTimeoutMs({ defaultMs: 100, maxMs: 500 }, { configuredTimeoutMs: '1000', agentDefaultMs: 200 })).toBe(500);
  expect(resolveTimeoutMs({ defaultMs: 100, maxMs: 500 }, { configuredTimeoutMs: 'invalid', agentDefaultMs: 200 })).toBe(200);
});
