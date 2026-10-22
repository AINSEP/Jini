import { describe, expect, it, vi } from 'vitest';
import { createFakeTauriSidecarCommandApi, createFakeTauriSingleInstanceApi, createFakeTauriWindowFactory } from '../testing.js';

describe('createFakeTauriSingleInstanceApi fixture', () => {
  it('stops notifying a listener once its unsubscribe function is called', () => {
    const api = createFakeTauriSingleInstanceApi({});
    const listener = vi.fn();
    const unsubscribe = api.onSecondInstance({ listener });
    api.emitSecondInstance({ args: ['--foo'], cwd: '/cwd' });
    unsubscribe();
    api.emitSecondInstance({ args: ['--bar'], cwd: '/cwd' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('createFakeTauriWindowFactory fixture', () => {
  it('stops notifying a close listener once its unsubscribe function is called', async () => {
    const { factory } = createFakeTauriWindowFactory({});
    const win = await factory({ label: 'w', url: 'https://example.test/' });
    const listener = vi.fn();
    const unsubscribe = win.onCloseRequested({ listener });
    unsubscribe();
    await win.close();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('createFakeTauriSidecarCommandApi fixture', () => {
  it('defaults the reported exit signal to SIGTERM when kill() is called without one', async () => {
    vi.useFakeTimers();
    try {
      const api = createFakeTauriSidecarCommandApi({});
      const child = await api.spawnSidecar({ binaryName: 'my-sidecar', args: [] });
      let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
      child.onExit({ listener: ({ code, signal }) => {
        exitInfo = { code, signal };
      } });
      child.kill({});
      await vi.advanceTimersByTimeAsync(0);
      expect(exitInfo).toEqual({ code: null, signal: 'SIGTERM' });
    } finally {
      vi.useRealTimers();
    }
  });
});
