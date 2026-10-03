import { describe, expect, it } from 'vitest';
import { createFakeBrowserWindowFactory } from '../testing.js';

describe('createFakeBrowserWindowFactory fixture', () => {
  it('exposes a no-op webContents.loadURL, matching the real ElectronWebContentsLike shape', async () => {
    const { factory } = createFakeBrowserWindowFactory({});
    const win = factory({}, {});
    await expect(win.webContents.loadURL({ url: 'jini://app/direct-webcontents-load' })).resolves.toBeUndefined();
  });
});
