import { createServer, type Server } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { closeHttpServer, DEFAULT_DAEMON_BIND_HOST, normalizeDaemonBindHost } from '../host-bootstrap.js';

describe('normalizeDaemonBindHost', () => {
  it('trims and returns a well-formed host string', () => {
    expect(normalizeDaemonBindHost(' 0.0.0.0 ')).toBe('0.0.0.0');
  });

  it('falls back to the loopback default for undefined', () => {
    expect(normalizeDaemonBindHost(undefined)).toBe(DEFAULT_DAEMON_BIND_HOST);
  });

  it('falls back to the loopback default for null', () => {
    expect(normalizeDaemonBindHost(null)).toBe(DEFAULT_DAEMON_BIND_HOST);
  });

  it('falls back to the loopback default for an empty string', () => {
    expect(normalizeDaemonBindHost('')).toBe(DEFAULT_DAEMON_BIND_HOST);
  });

  it('falls back to the loopback default for a whitespace-only string', () => {
    expect(normalizeDaemonBindHost('   ')).toBe(DEFAULT_DAEMON_BIND_HOST);
  });

  it('coerces a non-string value to its string form', () => {
    expect(normalizeDaemonBindHost(127)).toBe('127');
  });
});

describe('closeHttpServer', () => {
  it('resolves immediately without touching close() when the server is not listening', async () => {
    const server = { listening: false, close: vi.fn() } as unknown as Server;
    await closeHttpServer(server);
    expect(server.close).not.toHaveBeenCalled();
  });

  it('closes a real listening net server', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    expect(server.listening).toBe(true);

    await closeHttpServer(server);
    expect(server.listening).toBe(false);
  });

  it('rejects when the underlying close() reports an error', async () => {
    const server = {
      listening: true,
      close: (cb: (error?: Error) => void) => cb(new Error('close failed')),
      closeIdleConnections: vi.fn(),
      closeAllConnections: vi.fn(),
    } as unknown as Server;

    await expect(closeHttpServer(server)).rejects.toThrow('close failed');
  });

  it('force-closes remaining connections once closeTimeoutMs elapses without close() ever calling back', async () => {
    vi.useFakeTimers();
    try {
      const closeIdleConnections = vi.fn();
      const closeAllConnections = vi.fn();
      const server = {
        listening: true,
        // Never invokes its callback — simulates a connection that never drains on its own.
        close: vi.fn(),
        closeIdleConnections,
        closeAllConnections,
      } as unknown as Server;

      const closePromise = closeHttpServer(server, { closeTimeoutMs: 1000, idleCloseMs: 200 });
      let settled = false;
      void closePromise.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(200);
      expect(closeIdleConnections).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(800);
      expect(closeAllConnections).toHaveBeenCalledTimes(1);
      await closePromise;
      expect(settled).toBe(true);
      // The `.finally()` cleanup calls `closeIdleConnections` a second time regardless of which
      // path resolved the promise.
      expect(closeIdleConnections).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps idleCloseMs at closeTimeoutMs when idleCloseMs is larger, instead of waiting the full uncapped delay', async () => {
    vi.useFakeTimers();
    try {
      const closeIdleConnections = vi.fn();
      const closeAllConnections = vi.fn();
      const server = {
        listening: true,
        // Never invokes its callback, so only the timer-driven paths can resolve this.
        close: vi.fn(),
        closeIdleConnections,
        closeAllConnections,
      } as unknown as Server;

      const closePromise = closeHttpServer(server, { closeTimeoutMs: 1000, idleCloseMs: 5000 });

      // Without the `Math.min(idleCloseMs, closeTimeoutMs)` cap, the idle timer would still be
      // pending at t=999 (scheduled for the uncapped 5000ms) — advancing just short of
      // closeTimeoutMs must not have triggered it either way yet.
      await vi.advanceTimersByTimeAsync(999);
      expect(closeIdleConnections).not.toHaveBeenCalled();

      // At t=1000 (closeTimeoutMs), the capped idle timer and the hard timeout coincide (the cap
      // forces idleCloseMs down to exactly closeTimeoutMs whenever it would otherwise exceed it) —
      // proving the cap took effect rather than the idle timer waiting for the full 5000ms.
      await vi.advanceTimersByTimeAsync(1);
      expect(closeIdleConnections).toHaveBeenCalled();
      expect(closeAllConnections).toHaveBeenCalledTimes(1);

      await closePromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a resolveOnce call that arrives after the hard timeout already resolved it', async () => {
    vi.useFakeTimers();
    try {
      let closeCallback: ((error?: Error) => void) | undefined;
      const server = {
        listening: true,
        close: (cb: (error?: Error) => void) => {
          closeCallback = cb;
        },
        closeIdleConnections: vi.fn(),
        closeAllConnections: vi.fn(),
      } as unknown as Server;

      const closePromise = closeHttpServer(server, { closeTimeoutMs: 100, idleCloseMs: 50 });
      await vi.advanceTimersByTimeAsync(100);
      // The hard timeout already resolved this — a late, successful close() callback firing
      // afterward must be a no-op, not a second resolve.
      closeCallback?.();
      await expect(closePromise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not double-resolve or double-reject once already settled', async () => {
    let closeCallback: ((error?: Error) => void) | undefined;
    const server = {
      listening: true,
      close: (cb: (error?: Error) => void) => {
        closeCallback = cb;
      },
      closeIdleConnections: vi.fn(),
      closeAllConnections: vi.fn(),
    } as unknown as Server;

    const closePromise = closeHttpServer(server);
    closeCallback?.();
    closeCallback?.(new Error('should be ignored — already resolved'));
    await expect(closePromise).resolves.toBeUndefined();
  });
});
