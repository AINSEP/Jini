import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { readLiveDaemonRegistryRecord, resolveDaemonRegistryPath, writeDaemonRegistryRecord } from '@jini-ai/sidecar';

/** The real registry reader, bound the way the bin entry binds it. */
const registry = { resolvePath: resolveDaemonRegistryPath, readLiveRecord: readLiveDaemonRegistryRecord };

import { resolveDaemonUrl } from '../daemon-url.js';
import { createLocalDaemonDiscovery } from '../local-daemon-discovery.js';
import { mkdir as mkdirForWriter, writeFile as writeFileForWriter } from 'node:fs/promises';
import { dirname as dirnameForWriter } from 'node:path';
/** A plain JSON writer for seeding registry records: these tests read discovery, not write durability
 * (sidecar's own tests cover the atomic writer); hosts pass node-adapters' `nodeAtomicWriter`. */
const testWriter = { writeJson: async ({ filePath, data }: { filePath: string; data: unknown }) => {
  await mkdirForWriter(dirnameForWriter(filePath), { recursive: true });
  await writeFileForWriter(filePath, `${JSON.stringify(data, null, 2)}\n`);
} };

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
    await writeDaemonRegistryRecord({ writer: testWriter, registryPath: resolveDaemonRegistryPath({ dataDir }), record: {
      url: 'http://127.0.0.1:54213',
      host: '127.0.0.1',
      port: 54213,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    } });

    const discover = createLocalDaemonDiscovery({ dataDir, registry });
    await expect(discover({ env: process.env }, { timeoutMs: 800 })).resolves.toBe('http://127.0.0.1:54213');
  });

  it('discovers the url from an explicit registryPath, taking precedence over dataDir', async () => {
    const dataDir = await makeTempDataDir();
    const customDir = await makeTempDataDir();
    const registryPath = join(customDir, 'custom.json');
    await writeDaemonRegistryRecord({ writer: testWriter, registryPath, record: {
      url: 'http://127.0.0.1:9999',
      host: '127.0.0.1',
      port: 9999,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    } });
    // A record also exists at the dataDir-derived default, at a different port — proves
    // registryPath, not dataDir, wins when both are given.
    await writeDaemonRegistryRecord({ writer: testWriter, registryPath: resolveDaemonRegistryPath({ dataDir }), record: {
      url: 'http://127.0.0.1:1111',
      host: '127.0.0.1',
      port: 1111,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    } });

    const discover = createLocalDaemonDiscovery({ dataDir, registryPath, registry });
    await expect(discover({ env: process.env }, { timeoutMs: 800 })).resolves.toBe('http://127.0.0.1:9999');
  });

  it('resolves null (not rejects) when no registry file exists at all', async () => {
    const dataDir = await makeTempDataDir();
    const discover = createLocalDaemonDiscovery({ dataDir, registry });
    await expect(discover({ env: process.env }, { timeoutMs: 800 })).resolves.toBeNull();
  });

  it('resolves null for a stale record whose recording process has actually exited — would incorrectly resolve without the liveness check', async () => {
    const dataDir = await makeTempDataDir();
    const deadPid = await spawnAndAwaitExit();
    await writeDaemonRegistryRecord({ writer: testWriter, registryPath: resolveDaemonRegistryPath({ dataDir }), record: {
      url: 'http://127.0.0.1:54213',
      host: '127.0.0.1',
      port: 54213,
      pid: deadPid,
      startedAt: new Date().toISOString(),
    } });

    const discover = createLocalDaemonDiscovery({ dataDir, registry });
    await expect(discover({ env: process.env }, { timeoutMs: 800 })).resolves.toBeNull();
  });

  it('throws synchronously at build time when neither dataDir nor registryPath is given', () => {
    // @ts-expect-error Deliberately omit the required location to assert runtime validation.
    expect(() => createLocalDaemonDiscovery({ registry })).toThrow(/requires either dataDir or registryPath/);
  });

  describe('wired into resolveDaemonUrl', () => {
    it('is used as the discover fallback, below an explicit flag/env, above defaultUrl', async () => {
      const dataDir = await makeTempDataDir();
      await writeDaemonRegistryRecord({ writer: testWriter, registryPath: resolveDaemonRegistryPath({ dataDir }), record: {
        url: 'http://127.0.0.1:54213',
        host: '127.0.0.1',
        port: 54213,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      } });
      const discover = createLocalDaemonDiscovery({ dataDir, registry });

      await expect(
        resolveDaemonUrl({ env: process.env }, { discover, defaultUrl: 'http://default.example' }),
      ).resolves.toBe('http://127.0.0.1:54213');

      // An explicit flag still wins over local discovery.
      await expect(
        resolveDaemonUrl({ env: process.env }, { flagUrl: 'http://flag.example', discover, defaultUrl: 'http://default.example' }),
      ).resolves.toBe('http://flag.example');
    });

    it('falls through to defaultUrl when local discovery finds nothing live', async () => {
      const dataDir = await makeTempDataDir();
      const discover = createLocalDaemonDiscovery({ dataDir, registry });

      await expect(
        resolveDaemonUrl({ env: process.env }, { discover, defaultUrl: 'http://default.example' }),
      ).resolves.toBe('http://default.example');
    });
  });
});

// XC-5: discovery resolves the path and reads the record only through the injected registry reader;
// a stale record (the reader's `null` verdict) is never selected.
describe('createLocalDaemonDiscovery — injected registry reader', () => {
  it('reads through the injected path resolver and reader, and never selects a stale record', async () => {
    const reads: string[] = [];
    let live: { url: string } | null = { url: 'http://127.0.0.1:4555' };
    const fakeRegistry = {
      resolvePath: ({ dataDir }: { dataDir: string }) => `${dataDir}/injected-registry.json`,
      readLiveRecord: async ({ registryPath }: { registryPath: string }) => { reads.push(registryPath); return live; },
    };
    const discover = createLocalDaemonDiscovery({ dataDir: '/data', registry: fakeRegistry });
    await expect(discover({ env: process.env }, { timeoutMs: 800 })).resolves.toBe('http://127.0.0.1:4555');
    live = null;
    await expect(discover({ env: process.env }, { timeoutMs: 800 })).resolves.toBeNull();
    expect(reads).toEqual(['/data/injected-registry.json', '/data/injected-registry.json']);
  });
});
