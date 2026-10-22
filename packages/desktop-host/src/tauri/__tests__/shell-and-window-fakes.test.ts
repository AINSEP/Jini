/** Tauri `dirExists`'s never-throws contract and the exported fake window's close-request ordering. */
import { expect, it } from 'vitest';
import { createTauriShellPort } from '../tauri-shell.js';
import { createFakeTauriDialogApi, createFakeTauriShellApi, createFakeTauriWindowFactory } from '../testing.js';

it('dirExists resolves false when the fs plugin itself rejects (permission error)', async () => {
  const port = createTauriShellPort({
    shell: createFakeTauriShellApi({}), dialog: createFakeTauriDialogApi({}),
    fs: { exists: async () => { throw new Error('forbidden path'); }, stat: async () => { throw new Error('unreached'); } },
  });
  await expect(port.dirExists({ path: '/private' })).resolves.toBe(false);
});

it('the fake window runs close-requested listeners before it is closed, and not after they unsubscribe', async () => {
  const { factory } = createFakeTauriWindowFactory({});
  const win = await factory({ label: 'main', url: 'app://index.html' });
  const seen: string[] = [];
  const unsubscribe = win.onCloseRequested({ listener: () => { seen.push(`requested closed=${win.isClosed()}`); } });
  win.onClosed!({ listener: () => { seen.push(`closed closed=${win.isClosed()}`); } });
  await win.close();
  expect(seen).toEqual(['requested closed=false', 'closed closed=true']);

  const second = await factory({ label: 'second', url: 'app://index.html' });
  const calls: string[] = [];
  const stop = second.onCloseRequested({ listener: () => { calls.push('requested'); } });
  stop();
  stop();
  await second.close();
  expect(calls).toEqual([]);
  unsubscribe();
});
