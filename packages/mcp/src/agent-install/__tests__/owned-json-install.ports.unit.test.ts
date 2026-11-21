/**
 * @file R11b-1 T1: `installOwnedJsonAgent` takes its lock and writer from the injected `files` port.
 * Order: lock taken -> (backup only when a file existed) -> write with `refuseSymlink: true`, all
 * inside the lock; lock path `<configPath>.jini-lock` with the same options as before.
 */
import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FileLockPortOptions } from '@jini-ai/core/contracts/runtime';
import { installOwnedJsonAgent, type OwnedJsonInstallFiles } from '../owned-json-install.js';
import { planAgentInstall } from '../install.js';

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });

function recordingFiles() {
  const log: string[] = [];
  let lock: { lockPath: string; options: FileLockPortOptions | undefined } | undefined;
  let written: { filePath: string; options: unknown } | undefined;
  const files: OwnedJsonInstallFiles = {
    fileLock: { withFileLock: async ({ lockPath, run }, options) => {
      lock = { lockPath, options }; log.push('lock');
      try { return await run({} as never); } finally { log.push('unlock'); }
    } },
    writer: {
      backupOriginalOnce: async ({ filePath }) => { log.push(`backup ${filePath}`); },
      writeText: async ({ filePath }, options) => { written = { filePath, options }; log.push(`write ${filePath}`); },
    },
  };
  return { files, log, lock: () => lock, written: () => written };
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'mcp-owned-ports-')); homes.push(home);
  const base = { agentId: 'antigravity', allowed: true, ctx: { home, platform: 'linux' as const, serverName: 'jini' },
    spec: { command: 'node', args: ['/bridge.js'], env: {} } };
  const plan = planAgentInstall({ ...base, slug: 'antigravity' });
  if (plan.kind !== 'json') throw new Error('Expected JSON');
  return { base, file: plan.configPath };
}

test('a first install locks, writes with refuseSymlink inside the lock, and takes no backup', async () => {
  const { base, file } = await fixture();
  const rec = recordingFiles();
  await installOwnedJsonAgent({ ...base, files: rec.files });
  expect(rec.log).toEqual(['lock', `write ${file}`, 'unlock']);
  expect(rec.lock()).toEqual({ lockPath: `${file}.jini-lock`, options: { createParent: true, timeoutMs: 5000 } });
  expect(rec.written()).toEqual({ filePath: file, options: { refuseSymlink: true } });
});

test('an existing foreign config is backed up before the write, both inside the lock', async () => {
  const { base, file } = await fixture();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
  const rec = recordingFiles();
  await installOwnedJsonAgent({ ...base, files: rec.files });
  expect(rec.log).toEqual(['lock', `backup ${file}`, `write ${file}`, 'unlock']);
});

test('a refusal before planning touches neither the lock nor the writer', async () => {
  const { base } = await fixture();
  const rec = recordingFiles();
  await expect(installOwnedJsonAgent({ ...base, allowed: false, files: rec.files })).rejects.toThrow(/Allow/);
  expect(rec.log).toEqual([]);
});
