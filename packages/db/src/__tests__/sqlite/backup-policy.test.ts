import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, vi } from 'vitest';
import { assertDatabaseCopySpace, DatabaseDiskSpaceError, pruneDatabaseCopies } from '../../sqlite/backup-policy.js';

test('copy preflight preserves errors other than a missing destination directory', async () => {
  const probe = vi.spyOn(fs, 'statfs');
  try {
    for (const code of ['EACCES', 'EIO', 'ENOTDIR']) {
      const failure = Object.assign(new Error(`statfs failed: ${code}`), { code });
      probe.mockRejectedValueOnce(failure);
      await assert.rejects(
        assertDatabaseCopySpace({ sourcePath: ':memory:', destinationPath: '/copy.db' }),
        (error: unknown) => error === failure,
      );
    }
  } finally { probe.mockRestore(); }
});

test('a missing source remains a source error without probing destination space', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-missing-source-'));
  const sourcePath = path.join(dir, 'missing.db');
  const probe = vi.spyOn(fs, 'statfs');
  try {
    await assert.rejects(
      assertDatabaseCopySpace({ sourcePath, destinationPath: path.join(dir, 'copy.db') }),
      { code: 'ENOENT', syscall: 'stat', path: sourcePath },
    );
    assert.equal(probe.mock.calls.length, 0);
  } finally { probe.mockRestore(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('disk budget accepts equality and rejects one byte below source size times 1.2 plus 50 MB', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-budget-'));
  const sourcePath = path.join(dir, 'source.db');
  const destinationPath = path.join(dir, 'copy.db');
  await fs.writeFile(sourcePath, Buffer.alloc(10 * 1024 * 1024));
  const space = await fs.statfs(dir);
  const requiredBytes = 62 * 1024 * 1024;
  const probe = vi.spyOn(fs, 'statfs').mockResolvedValue({ ...space, bavail: requiredBytes, bsize: 1 });
  try {
    await assert.doesNotReject(assertDatabaseCopySpace({ sourcePath, destinationPath }));
    probe.mockResolvedValue({ ...space, bavail: requiredBytes - 1, bsize: 1 });
    await assert.rejects(assertDatabaseCopySpace({ sourcePath, destinationPath }), DatabaseDiskSpaceError);
    assert.equal(probe.mock.calls[0]?.[0], dir, 'inspect the destination filesystem');
  } finally { probe.mockRestore(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('retention never deletes just-written or protected copies, and never crosses folders', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-policy-'));
  try {
    const copies = Array.from({ length: 10 }, (_, index) => ({ filePath: path.join(dir, `${index + 1}.db`), createdAt: index + 1 }));
    for (const copy of copies) await fs.writeFile(copy.filePath, 'COPY');
    const justWritten = path.join(dir, '10.db');
    const foreignPath = path.join(dir, 'other', '100.db');
    await fs.mkdir(path.dirname(foreignPath));
    await fs.writeFile(foreignPath, 'FOREIGN');
    // The new copy may have an older clock stamp; its lifecycle wins over timestamp ordering.
    const candidates = copies.map(copy => ({ ...copy, createdAt: copy.filePath === justWritten ? 0 : copy.createdAt }));
    candidates.push({ filePath: foreignPath, createdAt: 100 });
    await pruneDatabaseCopies({ copies: candidates, justWritten }, { protectedPaths: new Set([path.join(dir, '1.db')]) });
    assert.deepEqual((await fs.readdir(dir)).sort(), ['1.db', '10.db', '5.db', '6.db', '7.db', '8.db', '9.db', 'other']);
    assert.equal(await fs.readFile(foreignPath, 'utf8'), 'FOREIGN');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
