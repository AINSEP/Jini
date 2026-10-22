import { afterEach, expect, it, vi } from 'vitest';
import type { TauriWindowLike } from '../tauri-surfaces.js';
import { createTauriWindowLifecyclePort } from '../tauri-window-lifecycle.js';

afterEach(() => vi.useRealTimers());

it('retains a main window after a canceled request and notifies only after actual closure', async () => {
  vi.useFakeTimers();
  let closed = false;
  const requested = new Set<() => void>();
  const win: TauriWindowLike = {
    show: vi.fn(async () => {}), hide: async () => {}, setFocus: async () => {},
    navigate: async () => {}, close: async () => {}, isClosed: () => closed,
    onCloseRequested: ({ listener }) => { requested.add(listener); return () => { requested.delete(listener); }; },
  };
  const port = createTauriWindowLifecyclePort({ createTauriWindow: async () => win });
  const handle = await port.createWindow({ url: 'https://example.test' });
  const listener = vi.fn();
  handle.onClosed({ listener });
  for (const callback of requested) callback();
  await vi.advanceTimersByTimeAsync(100);
  expect(port.getMainWindow()).toBe(handle);
  expect(listener).not.toHaveBeenCalled();
  port.showMainWindow();
  expect(win.show).toHaveBeenCalledOnce();

  closed = true;
  await vi.advanceTimersByTimeAsync(50);
  expect(port.getMainWindow()).toBeNull();
  expect(listener).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('uses a completed-close binding without polling or observing close requests', async () => {
  vi.useFakeTimers();
  let closed = false;
  const destroyed = new Set<() => void>();
  const win: TauriWindowLike = {
    show: async () => {}, hide: async () => {}, setFocus: async () => {}, navigate: async () => {},
    close: async () => {}, isClosed: () => closed,
    onCloseRequested: vi.fn(() => () => {}),
    onClosed: ({ listener }) => { destroyed.add(listener); return () => { destroyed.delete(listener); }; },
  };
  const port = createTauriWindowLifecyclePort({ createTauriWindow: async () => win });
  const handle = await port.createWindow({ url: 'https://example.test' });
  expect(port.getMainWindow()).toBe(handle);
  expect(win.onCloseRequested).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  closed = true;
  for (const listener of destroyed) listener();
  expect(port.getMainWindow()).toBeNull();
});
