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
  it('prefers a valid env override over the agent default and kernel default', () => {
    const ms = resolveTimeoutMs({ defaultMs: 1_000, maxMs: 100_000 }, { envVar: 'X_TIMEOUT_MS', agentDefaultMs: 5_000, env: { X_TIMEOUT_MS: '20000' } });
    expect(ms).toBe(20_000);
  });

  it('falls back to the agent default when the env var is absent', () => {
    const ms = resolveTimeoutMs({ defaultMs: 1_000, maxMs: 100_000 }, { envVar: 'X_TIMEOUT_MS', agentDefaultMs: 5_000, env: {} });
    expect(ms).toBe(5_000);
  });

  it('falls back to the kernel default when neither env nor agent default is set', () => {
    const ms = resolveTimeoutMs({ defaultMs: 1_000, maxMs: 100_000 }, { env: {} });
    expect(ms).toBe(1_000);
  });

  it('treats a non-numeric or non-positive env value as absent rather than throwing', () => {
    expect(resolveTimeoutMs({ defaultMs: 1_000, maxMs: 100_000 }, { envVar: 'X', agentDefaultMs: 5_000, env: { X: 'nope' } })).toBe(5_000);
    expect(resolveTimeoutMs({ defaultMs: 1_000, maxMs: 100_000 }, { envVar: 'X', agentDefaultMs: 5_000, env: { X: '-5' } })).toBe(5_000);
    expect(resolveTimeoutMs({ defaultMs: 1_000, maxMs: 100_000 }, { envVar: 'X', agentDefaultMs: 5_000, env: { X: '0' } })).toBe(5_000);
  });

  it('clamps the resolved value to maxMs regardless of source', () => {
    expect(resolveTimeoutMs({ defaultMs: 1_000, maxMs: 2_000 }, { envVar: 'X', env: { X: '999999' } })).toBe(2_000);
  });

  it('falls back to process.env when no env source is injected', () => {
    // Every other case in this suite passes `env` explicitly; omitting it
    // exercises the `input.env ?? (...)` fallback itself, which reads the
    // real `process.env` (there's no `X_TIMEOUT_MS_NEVER_SET` var in this
    // process, so resolution still falls through to the agent default).
    const ms = resolveTimeoutMs({ defaultMs: 1_000, maxMs: 100_000 }, { envVar: 'X_TIMEOUT_MS_NEVER_SET', agentDefaultMs: 5_000 });
    expect(ms).toBe(5_000);
  });

  it('falls back to {} when the global `process` itself is unavailable (a non-Node runtime) and no env override is set', () => {
    // Narrows the `input.env ?? (typeof process !== 'undefined' ? process.env
    // : {})` fallback's own inner ternary — the `{}` arm only exists for a
    // non-Node embedding of this pure function, so it's simulated here via
    // vi.stubGlobal rather than split into a separate jsdom-environment file
    // (see this session's own vitest coverage-v8 environment-split note: a
    // split file undercounts branches, whereas stubbing the global in place
    // measures correctly). Restored synchronously in `finally` since
    // `resolveTimeoutMs` itself makes no async gap.
    vi.stubGlobal('process', undefined);
    try {
      const ms = resolveTimeoutMs({ defaultMs: 1_000, maxMs: 100_000 }, { agentDefaultMs: 5_000 });
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
