import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  lstat,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  createPlaygroundAttachmentRegistry,
  detectPlaygroundAttachmentKind,
} from './playground-attachment-registry.js';

async function fixture(options: {
  maxAttachments?: number;
  maxStoredAttachments?: number;
  retentionMs?: number;
} = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'jini-registry-'));
  const registry = await createPlaygroundAttachmentRegistry({
    uploadDirectory: root,
    ...options,
  });
  return { root, registry };
}

describe('playground attachment registry', () => {
  it('returns opaque capabilities and replaces forged renderer metadata on a one-time claim', async () => {
    const { root, registry } = await fixture();
    const batchDirectory = await registry.createBatchDirectory('batch-0001');
    const filePath = resolve(batchDirectory, 'image.png');
    await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]), { mode: 0o600 });
    const attachment = await registry.register({
      batchId: 'batch-0001',
      path: filePath,
      name: 'image.png',
      kind: 'image',
      size: 4,
    });

    expect(attachment.path).toMatch(/^attachment:[a-f0-9-]{36}$/u);
    expect(attachment.path).not.toContain(root);
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(batchDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);

    const claim = await registry.claim([{
      ...attachment,
      name: 'forged.txt',
      kind: 'file',
      size: 999,
    }], 'run-1');
    expect(claim).toEqual({
      attachments: [{
        path: filePath,
        name: 'image.png',
        kind: 'image',
        size: 4,
      }],
      batchDirectory,
    });
    await expect(registry.claim([attachment], 'run-2'))
      .rejects.toThrow('unknown or already claimed');
    await registry.cleanupRun('run-1');
    await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await registry.dispose();
  });

  it('rejects a file retargeted to a symlink after registration', async () => {
    const { root, registry } = await fixture();
    const batchDirectory = await registry.createBatchDirectory('batch-0002');
    const outside = resolve(root, 'outside.txt');
    const filePath = resolve(batchDirectory, 'upload.txt');
    await writeFile(outside, 'outside');
    await writeFile(filePath, 'inside', { mode: 0o600 });
    const attachment = await registry.register({
      batchId: 'batch-0002',
      path: filePath,
      name: 'upload.txt',
      kind: 'file',
      size: 6,
    });
    await rm(filePath);
    await symlink(outside, filePath);

    await expect(registry.claim([attachment], 'run-symlink'))
      .rejects.toThrow('changed after upload');
    expect((await lstat(filePath)).isSymbolicLink()).toBe(true);
    await registry.dispose();
  });

  it('does not delete an outside file rejected before registration', async () => {
    const { root, registry } = await fixture();
    await registry.createBatchDirectory('batch-0007');
    const outside = resolve(root, 'outside-preserved.txt');
    await writeFile(outside, 'preserve me', { mode: 0o600 });
    await expect(registry.register({
      batchId: 'batch-0007',
      path: outside,
      name: 'outside-preserved.txt',
      kind: 'file',
      size: 11,
    })).rejects.toThrow('outside its batch');
    await expect(stat(outside)).resolves.toBeDefined();
    await registry.dispose();
  });

  it('serializes quota reservations, removes the rejected file, and enforces registry-wide caps', async () => {
    const { registry } = await fixture({ maxAttachments: 1 });
    const batchDirectory = await registry.createBatchDirectory('batch-0003');
    const firstPath = resolve(batchDirectory, 'first.txt');
    const secondPath = resolve(batchDirectory, 'second.txt');
    await Promise.all([
      writeFile(firstPath, 'first', { mode: 0o600 }),
      writeFile(secondPath, 'second', { mode: 0o600 }),
    ]);
    const results = await Promise.allSettled([
      registry.register({
        batchId: 'batch-0003',
        path: firstPath,
        name: 'first.txt',
        kind: 'file',
        size: 5,
      }),
      registry.register({
        batchId: 'batch-0003',
        path: secondPath,
        name: 'second.txt',
        kind: 'file',
        size: 6,
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const remaining = await Promise.allSettled([stat(firstPath), stat(secondPath)]);
    expect(remaining.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await registry.dispose();

    const global = await fixture({ maxStoredAttachments: 1 });
    const oneDir = await global.registry.createBatchDirectory('batch-0004');
    const twoDir = await global.registry.createBatchDirectory('batch-0005');
    const onePath = resolve(oneDir, 'one.txt');
    const twoPath = resolve(twoDir, 'two.txt');
    await writeFile(onePath, 'one', { mode: 0o600 });
    await writeFile(twoPath, 'two', { mode: 0o600 });
    await global.registry.register({
      batchId: 'batch-0004',
      path: onePath,
      name: 'one.txt',
      kind: 'file',
      size: 3,
    });
    await expect(global.registry.register({
      batchId: 'batch-0005',
      path: twoPath,
      name: 'two.txt',
      kind: 'file',
      size: 3,
    })).rejects.toThrow('storage is full');
    await expect(stat(twoPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await global.registry.dispose();
  });

  it('prunes expired unclaimed uploads and detects image types from signatures', async () => {
    const { registry } = await fixture({ retentionMs: 0 });
    const batchDirectory = await registry.createBatchDirectory('batch-0006');
    const filePath = resolve(batchDirectory, 'old.txt');
    await writeFile(filePath, 'old', { mode: 0o600 });
    await registry.register({
      batchId: 'batch-0006',
      path: filePath,
      name: 'old.txt',
      kind: 'file',
      size: 3,
    });
    await registry.pruneExpired(Date.now() + 1);
    await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(detectPlaygroundAttachmentKind(
      Uint8Array.from([0xff, 0xd8, 0xff]),
    )).toBe('image');
    expect(detectPlaygroundAttachmentKind(new TextEncoder().encode('plain text')))
      .toBe('file');
    await registry.dispose();
  });
});
