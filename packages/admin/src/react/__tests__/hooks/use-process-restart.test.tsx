import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProcessRestart, type ProcessRestartPort } from '../../hooks/use-process-restart.js';

const messages = { restartFallback: 'Restart failed', statusFallback: 'Status failed' };
function fixture() {
  const port = {
    restart: vi.fn<ProcessRestartPort['restart']>(async () => ({ ok: true })),
    getStatus: vi.fn<ProcessRestartPort['getStatus']>(async () => ({ failed: false })),
  };
  const describeError = vi.fn(({ error, fallback }: { error: unknown; fallback: string }) => error instanceof Error ? error.message : fallback);
  return { port, describeError, messages };
}
const flush = async () => { await act(async () => { await Promise.resolve(); }); };

afterEach(() => { vi.useRealTimers(); });

describe('useProcessRestart status', () => {
  it('starts unknown and checking, then reports a latched failure after one mount read without polling', async () => {
    vi.useFakeTimers();
    const deps = fixture();
    deps.port.getStatus.mockResolvedValue({ failed: true });
    const { result, rerender, unmount } = renderHook(() => useProcessRestart(deps));
    expect(result.current.knownFailed).toBeNull();
    expect(result.current.checkingStatus).toBe(true);
    await flush();
    expect(result.current.knownFailed).toBe(true);
    expect(result.current.checkingStatus).toBe(false);
    expect(result.current.statusError).toBeNull();
    rerender();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(deps.port.getStatus).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('reports false for no latched failure and exposes an immediate manual status read', async () => {
    const deps = fixture();
    const { result } = renderHook(() => useProcessRestart(deps, { postRestartCheckDelayMs: 2500 }));
    await flush();
    expect(result.current.knownFailed).toBe(false);
    deps.port.getStatus.mockResolvedValueOnce({ failed: true });
    await act(async () => { await result.current.checkStatus(); });
    expect(result.current.knownFailed).toBe(true);
    expect(deps.port.getStatus).toHaveBeenCalledTimes(2);
  });

  it('routes a status failure through describeError and preserves the last known status', async () => {
    const deps = fixture();
    const error = new Error('network down');
    deps.port.getStatus.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useProcessRestart(deps));
    await flush();
    expect(result.current.statusError).toBe('network down');
    expect(result.current.knownFailed).toBeNull();
    expect(result.current.checkingStatus).toBe(false);
    expect(deps.describeError).toHaveBeenCalledWith({ error, fallback: messages.statusFallback });
    await act(async () => { await result.current.checkStatus(); });
    expect(result.current.statusError).toBeNull();
    expect(result.current.knownFailed).toBe(false);
    deps.port.getStatus.mockRejectedValueOnce('offline');
    await act(async () => { await result.current.checkStatus(); });
    expect(result.current.knownFailed).toBe(false);
    expect(result.current.statusError).toBe(messages.statusFallback);
  });
});

describe('useProcessRestart mutation', () => {
  it('stores the exact successful result and clears the in-flight state', async () => {
    const deps = fixture();
    const answer = { ok: true };
    deps.port.restart.mockResolvedValueOnce(answer);
    const { result } = renderHook(() => useProcessRestart(deps));
    await flush();
    expect(result.current.restartResult).toBeNull();
    expect(result.current.restartError).toBeNull();
    await act(async () => { await result.current.restart(); });
    expect(deps.port.restart).toHaveBeenCalledTimes(1);
    expect(result.current.restartResult).toBe(answer);
    expect(result.current.restartError).toBeNull();
    expect(result.current.restarting).toBe(false);
  });

  it('stores an ordinary refusal in restartResult without setting restartError', async () => {
    const deps = fixture();
    const answer = { ok: false, reason: 'shutting down' };
    deps.port.restart.mockResolvedValueOnce(answer);
    const { result } = renderHook(() => useProcessRestart(deps));
    await flush();
    await act(async () => { await result.current.restart(); });
    expect(result.current.restartResult).toEqual(answer);
    expect(result.current.restartError).toBeNull();
  });

  it.each([true, false])('re-checks status after a settled restart (ok=%s)', async (ok) => {
    const deps = fixture();
    deps.port.restart.mockResolvedValueOnce({ ok });
    deps.port.getStatus.mockResolvedValueOnce({ failed: true }).mockResolvedValueOnce({ failed: false });
    const { result } = renderHook(() => useProcessRestart(deps));
    await flush();
    expect(result.current.knownFailed).toBe(true);
    expect(deps.port.getStatus).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.restart(); });
    expect(result.current.knownFailed).toBe(false);
    expect(deps.port.getStatus).toHaveBeenCalledTimes(2);
  });

  it('waits the positive delay with restarting already false before the single follow-up read', async () => {
    vi.useFakeTimers();
    const deps = fixture();
    const { result } = renderHook(() => useProcessRestart(deps, { postRestartCheckDelayMs: 2500 }));
    await flush();
    let pending!: Promise<void>;
    act(() => { pending = result.current.restart(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.restarting).toBe(false);
    expect(result.current.checkingStatus).toBe(false);
    expect(deps.port.getStatus).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2499); });
    expect(deps.port.getStatus).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); await pending; });
    expect(deps.port.getStatus).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(deps.port.getStatus).toHaveBeenCalledTimes(2);
  });

  it.each([0, -1])('does not schedule a wait for a non-positive delay (%s)', async (delay) => {
    vi.useFakeTimers();
    const deps = fixture();
    const { result } = renderHook(() => useProcessRestart(deps, { postRestartCheckDelayMs: delay }));
    await flush();
    await act(async () => { await result.current.restart(); });
    expect(result.current.restarting).toBe(false);
    expect(deps.port.getStatus).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps an unexpected restart failure separate and still re-checks status', async () => {
    const deps = fixture();
    const error = new Error('forbidden');
    deps.port.restart.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useProcessRestart(deps));
    await flush();
    await act(async () => { await result.current.restart(); });
    expect(result.current.restartError).toBe('forbidden');
    expect(result.current.restartResult).toBeNull();
    expect(result.current.restarting).toBe(false);
    expect(deps.describeError).toHaveBeenCalledWith({ error, fallback: messages.restartFallback });
    expect(deps.port.getStatus).toHaveBeenCalledTimes(2);
  });

  it('sets restarting only while the mutation is in flight and clears the previous error on a new attempt', async () => {
    const deps = fixture();
    deps.port.restart.mockRejectedValueOnce('failure');
    const { result } = renderHook(() => useProcessRestart(deps));
    await flush();
    await act(async () => { await result.current.restart(); });
    expect(result.current.restartError).toBe(messages.restartFallback);
    let resolve!: (value: { ok: boolean }) => void;
    deps.port.restart.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.restart(); });
    expect(result.current.restarting).toBe(true);
    expect(result.current.restartError).toBeNull();
    await act(async () => { resolve({ ok: true }); await pending; });
    expect(result.current.restarting).toBe(false);
    expect(result.current.restartResult).toEqual({ ok: true });
  });

  it('preserves the last restart result when a later mutation and its re-check both fail', async () => {
    const deps = fixture();
    const answer = { ok: true };
    deps.port.restart.mockResolvedValueOnce(answer);
    const { result } = renderHook(() => useProcessRestart(deps));
    await flush();
    await act(async () => { await result.current.restart(); });
    deps.port.restart.mockRejectedValueOnce(new Error('restart rejected'));
    deps.port.getStatus.mockRejectedValueOnce(new Error('status rejected'));
    await act(async () => { await result.current.restart(); });
    expect(result.current.restartResult).toBe(answer);
    expect(result.current.restartError).toBe('restart rejected');
    expect(result.current.statusError).toBe('status rejected');
    expect(result.current.knownFailed).toBe(false);
  });

  it('does not overwrite a successful restart result when its re-check fails', async () => {
    const deps = fixture();
    const { result } = renderHook(() => useProcessRestart(deps));
    await flush();
    deps.port.getStatus.mockRejectedValueOnce(new Error('status rejected'));
    await act(async () => { await result.current.restart(); });
    expect(result.current.restartResult).toEqual({ ok: true });
    expect(result.current.restartError).toBeNull();
    expect(result.current.statusError).toBe('status rejected');
  });
});
