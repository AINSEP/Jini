import { expect, test, vi } from 'vitest';
import { createTauriSidecarLauncher } from '../tauri-sidecar.js';
import { createFakeTauriSidecarCommandApi } from '../testing.js';

test('default shutdown signals an active child once and does nothing after the retained exit', async () => {
  const api = createFakeTauriSidecarCommandApi({});
  const handle = await createTauriSidecarLauncher({ api }).launch({ command: 'fixture' });
  const exit = vi.fn();
  handle.process.onExit({ listener: exit });
  await handle.shutdown({});
  expect(exit).toHaveBeenCalledTimes(1);
  expect(exit).toHaveBeenCalledWith({ code: null, signal: 'SIGTERM' });
  const requestShutdown = vi.fn(async () => {});
  await handle.shutdown({}, { requestShutdown });
  expect(requestShutdown).not.toHaveBeenCalled();
  expect(exit).toHaveBeenCalledTimes(1);
});

test('readiness retains an ordinary numeric exit code and never invokes a probe after that exit', async () => {
  const api = createFakeTauriSidecarCommandApi({}, { exitImmediatelyWithCode: 9 });
  const handle = await createTauriSidecarLauncher({ api }).launch({ command: 'fixture' });
  await new Promise<void>(resolve => handle.process.onExit({ listener: () => resolve() }));
  const probe = vi.fn(async () => true);
  await expect(handle.waitUntilReady({ probe, isReady: ({ status }) => status })).rejects.toThrow('code=9, signal=none');
  expect(probe).not.toHaveBeenCalled();
  await handle.shutdown({});
});
