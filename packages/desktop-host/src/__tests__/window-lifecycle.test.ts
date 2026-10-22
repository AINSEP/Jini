import { describe, expect, it, vi } from 'vitest';
import { withMainWindowTracking, type WindowCreateOptions, type WindowHandle } from '../window-lifecycle.js';

function fakeWindow(): WindowHandle & { closedListeners: Array<() => void>; destroyed: boolean; shown: boolean } {
  const win = {
    closedListeners: [] as Array<() => void>,
    destroyed: false,
    shown: false,
    async loadUrl() {},
    show() {
      win.shown = true;
    },
    hide() {
      win.shown = false;
    },
    focus() {},
    close() {
      win.destroyed = true;
      for (const listener of win.closedListeners) listener();
    },
    isDestroyed() {
      return win.destroyed;
    },
    onClosed({ listener }: { listener: () => void }) {
      win.closedListeners.push(listener);
    },
  };
  return win;
}

describe('withMainWindowTracking', () => {
  it('tracks the created window as the main window', async () => {
    const created = fakeWindow();
    const port = withMainWindowTracking({ createWindowImpl: async (_options: Pick<WindowCreateOptions, 'url'>) => created });
    const handle = await port.createWindow({ url: 'https://example.test' });
    expect(handle).toBe(created);
    expect(port.getMainWindow()).toBe(created);
  });

  it('clears the tracked main window when it closes', async () => {
    const created = fakeWindow();
    const port = withMainWindowTracking({ createWindowImpl: async () => created });
    await port.createWindow({ url: 'https://example.test' });
    created.close();
    expect(port.getMainWindow()).toBeNull();
  });

  it('showMainWindow shows and focuses the tracked window, no-ops when absent or destroyed', async () => {
    const port = withMainWindowTracking({ createWindowImpl: async () => fakeWindow() });
    expect(() => port.showMainWindow()).not.toThrow();

    const created = fakeWindow();
    const focusSpy = vi.spyOn(created, 'focus');
    const port2 = withMainWindowTracking({ createWindowImpl: async () => created });
    await port2.createWindow({ url: 'https://example.test' });
    port2.showMainWindow();
    expect(created.shown).toBe(true);
    expect(focusSpy).toHaveBeenCalledTimes(1);

    created.close();
    port2.showMainWindow();
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });
});
