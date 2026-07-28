import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { resolveDaemonRegistryPath, writeDaemonRegistryRecord } from '@injini/sidecar';

import { resolveDaemonUrl } from '../daemon-url.js';
import { createLocalDaemonDiscovery } from '../local-daemon-discovery.js';

const tempDirs: string[] = [];
async function makeTempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jini-cli-local-daemon-discovery-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

/** Spawns a real short-lived child process and resolves once it has actually exited — the real
 * "stale record from a crashed daemon" scenario, not a mocked stand-in. */
async function spawnAndAwaitExit(): Promise<number> {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
  const pid = child.pid;
  if (pid == null) throw new Error('failed to spawn probe child process');
  await new Promise<void>((resolveExit, rejectExit) => {
    child.once('exit', () => resolveExit());
    child.once('error', rejectExit);
  });
  return pid;
}

describe('createLocalDaemonDiscovery', () => {
  it('discovers the url from a live registry record written for dataDir, by dataDir', async () => {
    const dataDir = await makeTempDataDir();
    await writeDaemonRegistryRecord(resolveDaemonRegistryPath(dataDir), {
      url: 'http://127.0.0.1:54213',
      host: '127.0.0.1',
      port: 54213,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });

    const discover = createLocalDaemonDiscovery({ dataDir });
    await expect(discover(process.env, 800)).resolves.toBe('http://127.0.0.1:54213');
  });

  it('discovers the url from an explicit registryPath, taking precedence over dataDir', async () => {
    const dataDir = await makeTempDataDir();
    const customDir = await makeTempDataDir();
    const registryPath = join(customDir, 'custom.json');
    await writeDaemonRegistryRecord(registryPath, {
      url: 'http://127.0.0.1:9999',
      host: '127.0.0.1',
      port: 9999,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    // A record also exists at the dataDir-derived default, at a different port — proves
    // registryPath, not dataDir, wins when both are given.
    await writeDaemonRegistryRecord(resolveDaemonRegistryPath(dataDir), {
      url: 'http://127.0.0.1:1111',
      host: '127.0.0.1',
      port: 1111,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });

    const discover = createLocalDaemonDiscovery({ dataDir, registryPath });
    await expect(discover(process.env, 800)).resolves.toBe('http://127.0.0.1:9999');
  });

  it('resolves null (not rejects) when no registry file exists at all', async () => {
    const dataDir = await makeTempDataDir();
    const discover = createLocalDaemonDiscovery({ dataDir });
    await expect(discover(process.env, 800)).resolves.toBeNull();
  });

  it('resolves null for a stale record whose recording process has actually exited — would incorrectly resolve without the liveness check', async () => {
    const dataDir = await makeTempDataDir();
    const deadPid = await spawnAndAwaitExit();
    await writeDaemonRegistryRecord(resolveDaemonRegistryPath(dataDir), {
      url: 'http://127.0.0.1:54213',
      host: '127.0.0.1',
      port: 54213,
      pid: deadPid,
      startedAt: new Date().toISOString(),
    });

    const discover = createLocalDaemonDiscovery({ dataDir });
    await expect(discover(process.env, 800)).resolves.toBeNull();
  });

  it('throws synchronously at build time when neither dataDir nor registryPath is given', () => {
    expect(() => createLocalDaemonDiscovery({})).toThrow(/requires either dataDir or registryPath/);
  });

  describe('wired into resolveDaemonUrl', () => {
    it('is used as the discover fallback, below an explicit flag/env, above defaultUrl', async () => {
      const dataDir = await makeTempDataDir();
      await writeDaemonRegistryRecord(resolveDaemonRegistryPath(dataDir), {
        url: 'http://127.0.0.1:54213',
        host: '127.0.0.1',
        port: 54213,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      });
      const discover = createLocalDaemonDiscovery({ dataDir });

      await expect(
        resolveDaemonUrl({ discover, defaultUrl: 'http://default.example' }),
      ).resolves.toBe('http://127.0.0.1:54213');

      // An explicit flag still wins over local discovery.
      await expect(
        resolveDaemonUrl({ flagUrl: 'http://flag.example', discover, defaultUrl: 'http://default.example' }),
      ).resolves.toBe('http://flag.example');
    });

    it('falls through to defaultUrl when local discovery finds nothing live', async () => {
      const dataDir = await makeTempDataDir();
      const discover = createLocalDaemonDiscovery({ dataDir });

      await expect(
        resolveDaemonUrl({ discover, defaultUrl: 'http://default.example' }),
      ).resolves.toBe('http://default.example');
    });
  });
});
