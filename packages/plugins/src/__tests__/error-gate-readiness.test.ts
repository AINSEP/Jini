import { expect, it } from 'vitest';
import { createPluginModuleSnapshotLifecycle, type PluginSnapshotFilesystem } from '../host/node/module-snapshot.js';

it('observes boot failure while preserving its identity for readiness awaiters and snapshots', async () => {
  const failure = new Error('snapshot directory refused');
  const fs: PluginSnapshotFilesystem = {
    mkdir: async () => { throw failure; }, mkdtemp: async () => '/unused', readdir: async () => [], rm: async () => {},
    lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false, mtimeMs: 0, ino: 1, dev: 1 }),
  };
  const lifecycle = createPluginModuleSnapshotLifecycle({ runtimeRoot: '/snapshots' }, {
    fs, process: { pid: 1, startedAtMs: 0, hostname: 'fixture', isAlive: () => true },
  });
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await expect(lifecycle.ready).rejects.toBe(failure);
  await expect(lifecycle.createSnapshot({ files: new Map() })).rejects.toBe(failure);
});
