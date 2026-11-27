import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { nodeProvisioningFileIo } from '../provisioning.node-io.js';

it('creates the parent directory and leaves only the final UTF-8 config after a write and replacement', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'publish-trust-config-'));
  try {
    const parent = join(dir, 'nested', 'site');
    const path = join(parent, 'trust.json');
    expect(await nodeProvisioningFileIo.read({ path })).toBeNull();
    await nodeProvisioningFileIo.write({ path, contents: '{"site":"Café local"}\n' });
    expect(await readFile(path, 'utf8')).toBe('{"site":"Café local"}\n');
    expect(await readdir(parent)).toEqual(['trust.json']);
    await nodeProvisioningFileIo.write({ path, contents: '{}\n' });
    expect(await nodeProvisioningFileIo.read({ path })).toBe('{}\n');
    expect(await readdir(parent)).toEqual(['trust.json']);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

it('propagates a real filesystem error instead of treating an unreadable config as nonexistent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'publish-trust-unreadable-'));
  try {
    const path = join(dir, 'trust.json');
    await mkdir(path);
    await expect(nodeProvisioningFileIo.read({ path })).rejects.toMatchObject({ code: 'EISDIR', syscall: 'read' }); // Node's readFile EISDIR carries no `path`.
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});
