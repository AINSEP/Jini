import { describe, expect, it } from 'vitest';
import { withRenderWindow } from '../render-window.js';
import { createFakeBrowserWindowFactory } from '../testing.js';
import type { ElectronBrowserWindowFactory, ElectronBrowserWindowOptions } from '../electron-surfaces.js';
import type { RenderOptions } from '../../render-service.js';

describe('hidden-window allocation and lifetime before extraction', () => {
  it.each([
    [{}, { show: false, width: 1024, height: 768, webPreferences: { javascript: true } }],
    [{ viewport: { width: 0, height: 0 }, resourcePolicy: { javascript: false } },
      { show: false, width: 0, height: 0, webPreferences: { javascript: false } }],
    [{ viewport: { width: 375, height: 812 }, resourcePolicy: { javascript: true } },
      { show: false, width: 375, height: 812, webPreferences: { javascript: true } }],
  ] satisfies Array<[RenderOptions, ElectronBrowserWindowOptions]>)('preserves native allocation options %j', async (options, expected) => {
    const fake = createFakeBrowserWindowFactory({});
    const seen: unknown[] = [];
    const factory: ElectronBrowserWindowFactory = (required, optional) => {
      seen.push([required, optional]);
      return fake.factory(required, optional);
    };
    expect(await withRenderWindow({ createBrowserWindow: factory, html: '<p>hello</p>', options, run: async () => 'rendered' })).toBe('rendered');
    expect(seen).toEqual([[{}, expected]]);
    expect(fake.windows[0]!.isDestroyed()).toBe(true);
  });

  it('rejects an already aborted render before allocating a window', async () => {
    const fake = createFakeBrowserWindowFactory({});
    const controller = new AbortController();
    controller.abort();
    await expect(withRenderWindow({ createBrowserWindow: fake.factory, options: { signal: controller.signal }, run: async () => 'unused' }))
      .rejects.toMatchObject({ code: 'aborted', message: 'render aborted before starting' });
    expect(fake.windows).toEqual([]);
  });

  it('destroys the window after preparation fails and preserves the error', async () => {
    const fake = createFakeBrowserWindowFactory({});
    const error = new Error('preparation failed');
    await expect(withRenderWindow({ createBrowserWindow: fake.factory, options: {},
      prepare: async () => { throw error; }, run: async () => 'unused' })).rejects.toBe(error);
    expect(fake.windows[0]!.isDestroyed()).toBe(true);
  });

  it('does not destroy a window twice when preparation already destroyed it', async () => {
    const fake = createFakeBrowserWindowFactory({});
    let destroys = 0;
    const factory: ElectronBrowserWindowFactory = (required, options) => {
      const win = fake.factory(required, options);
      const destroy = win.destroy.bind(win);
      win.destroy = () => { destroys++; destroy(); };
      return win;
    };
    await expect(withRenderWindow({ createBrowserWindow: factory, options: {},
      prepare: async win => { win.destroy(); }, run: async () => 'unused' })).rejects.toMatchObject({
      code: 'aborted', message: 'render aborted during preparation',
    });
    expect(destroys).toBe(1);
  });
});
