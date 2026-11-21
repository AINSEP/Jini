/**
 * @file R11a T4: the plugin source service takes its cross-process lock from the injected `fileLock`
 * port. Pins the options it passes (`timeoutMs: 100`, `staleMs: Infinity`, the caller's `lockPorts`
 * spread FIRST so the service's own timeout/staleness win) and that a lock timeout still surfaces
 * as PLUGIN_SOURCE_BUSY.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, test } from 'vitest';
import { FileLockTimeoutError, type FileLockPort, type FileLockPortOptions } from '@jini-ai/core/contracts/runtime';
import { createPluginSourceService } from '../../node/source-drafts.js';
import { createPluginSourcePolicy } from '../../source-policy.js';
import type { PluginInstallerPort } from '../../node/install.js';
import { manifestHost } from '../support/fixture-bindings.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

function recordingLock(behaviour: 'run' | 'timeout') {
  const calls: Array<{ lockPath: string; options: FileLockPortOptions | undefined }> = [];
  const fileLock: FileLockPort = {
    withFileLock: async ({ lockPath, run }, options) => {
      calls.push({ lockPath, options });
      if (behaviour === 'timeout') throw new FileLockTimeoutError({ lockPath, holder: undefined, waitedMs: 100 });
      return run({ token: 'recorded' } as never);
    },
  };
  return { fileLock, calls };
}

async function service(fileLock: FileLockPort, lockPorts: { hostname: () => string; timeoutMs?: number }) {
  const root = await mkdtemp(path.join(tmpdir(), 'plugin-source-lock-')); roots.push(root);
  const installer: PluginInstallerPort = { preview: async () => { throw new Error('preview is outside this test'); }, install: async () => { throw new Error('install is outside this test'); } };
  const installDir = path.join(root, 'plugins');
  const sourceService = createPluginSourceService({ ...manifestHost, installDir, builtInIds: [], installer, fileLock,
    policy: createPluginSourcePolicy({ hosted: false, localInstallOptIn: false }), scaffoldEntry: 'export default {};\n',
    reload: async () => false, pruneVersions: async () => [] }, { temporaryDir: root, lockPorts: lockPorts as never });
  return { sourceService, installDir };
}

test('the injected lock receives the source-lock path, timeoutMs 100, staleMs Infinity and the caller hostname', async () => {
  const { fileLock, calls } = recordingLock('run');
  const hostname = () => 'host-a';
  const { sourceService, installDir } = await service(fileLock, { hostname, timeoutMs: 5 });
  await sourceService.create({ id: 'site-rules', name: 'Site rules', description: 'Content rules for this site.' });
  expect(calls.length).toBeGreaterThan(0);
  expect(calls[0]!.lockPath).toBe(path.resolve(installDir) + '-source-lock');
  expect(calls[0]!.options).toMatchObject({ timeoutMs: 100, staleMs: Infinity });
  expect(calls[0]!.options!.hostname).toBe(hostname);
});

test('a lock timeout from the injected port is reported as PLUGIN_SOURCE_BUSY', async () => {
  const { fileLock } = recordingLock('timeout');
  const { sourceService } = await service(fileLock, { hostname: () => 'host-a' });
  await expect(sourceService.create({ id: 'site-rules', name: 'Site rules', description: 'Content rules for this site.' }))
    .rejects.toMatchObject({ code: 'PLUGIN_SOURCE_BUSY' });
});
