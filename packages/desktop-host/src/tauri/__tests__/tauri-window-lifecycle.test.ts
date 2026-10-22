import { describe, expect, it } from 'vitest';
import { createTauriWindowLifecyclePort } from '../tauri-window-lifecycle.js';
import { createFakeTauriWindowFactory } from '../testing.js';

describe('createTauriWindowLifecyclePort', () => {
  it('creates a window, loads the url via navigate, and tracks it as the main window', async () => {
    const { factory, windows } = createFakeTauriWindowFactory({});
    const port = createTauriWindowLifecyclePort({ createTauriWindow: factory });
    const handle = await port.createWindow({ url: 'https://example.test/' });
    expect(port.getMainWindow()).toBe(handle);
    const win = windows[0] as unknown as { navigatedTo: string[] };
    expect(win.navigatedTo).toEqual(['https://example.test/']);
  });

  it('clears the main window after close', async () => {
    const { factory } = createFakeTauriWindowFactory({});
    const port = createTauriWindowLifecyclePort({ createTauriWindow: factory });
    const handle = await port.createWindow({ url: 'https://example.test/' });
    handle.close();
    await Promise.resolve();
    expect(port.getMainWindow()).toBeNull();
  });

  it('passes explicit width/height through to the Tauri window factory', async () => {
    const { factory } = createFakeTauriWindowFactory({});
    let capturedOptions: Parameters<typeof factory>[1] | undefined;
    const spyFactory: typeof factory = (requiredArgs, options = {}) => {
      capturedOptions = options;
      return factory(requiredArgs, options);
    };
    const port = createTauriWindowLifecyclePort({ createTauriWindow: spyFactory });
    await port.createWindow({ url: 'https://example.test/' }, { width: 800, height: 600 });
    expect(capturedOptions?.width).toBe(800);
    expect(capturedOptions?.height).toBe(600);
  });

  it('omits width/height from the factory options when not given', async () => {
    const { factory } = createFakeTauriWindowFactory({});
    let capturedOptions: Parameters<typeof factory>[1] | undefined;
    const spyFactory: typeof factory = (requiredArgs, options = {}) => {
      capturedOptions = options;
      return factory(requiredArgs, options);
    };
    const port = createTauriWindowLifecyclePort({ createTauriWindow: spyFactory });
    await port.createWindow({ url: 'https://example.test/' });
    expect(capturedOptions).not.toHaveProperty('width');
    expect(capturedOptions).not.toHaveProperty('height');
  });

  it('exposes show/hide/focus delegating to the underlying Tauri window', async () => {
    const { factory } = createFakeTauriWindowFactory({});
    const port = createTauriWindowLifecyclePort({ createTauriWindow: factory });
    const handle = await port.createWindow({ url: 'https://example.test/' });
    handle.show();
    handle.hide();
    handle.focus();
    expect(handle.isDestroyed()).toBe(false);
  });
});
