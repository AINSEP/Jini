import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { onTestFinished, test } from 'vitest';
import { measureStorageTree, type StorageTreeFs } from '../measure-tree.js';

async function tempTree(): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'jini-measure-')));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function write(root: string, relative: string, bytes: number): Promise<string> {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.alloc(bytes, 1));
  return file;
}

/** Real fs, except the listed paths answer EACCES — root in a container ignores chmod 000. */
function deniedFs(denied: ReadonlySet<string>): StorageTreeFs {
  const refuse = (target: string) => Object.assign(new Error(`EACCES: permission denied, '${target}'`), { code: 'EACCES' });
  return {
    lstat: async target => { if (denied.has(target)) throw refuse(target); return fs.lstat(target); },
    readdir: async target => { if (denied.has(`${target}/`)) throw refuse(target); return fs.readdir(target); },
  };
}

test('targets add up to the walked total, with the rest under other', async () => {
  const root = await tempTree();
  await write(root, 'uploads/a.png', 100);
  await write(root, 'uploads/nested/b.png', 50);
  await write(root, 'content.db', 400);
  await write(root, 'content.db-wal', 30);
  await write(root, 'config.json', 7);
  const result = await measureStorageTree({
    root,
    targets: [
      { id: 'uploads', path: path.join(root, 'uploads') },
      { id: 'db', path: path.join(root, 'content.db') },
      { id: 'wal', path: path.join(root, 'content.db-wal') },
      { id: 'missing', path: path.join(root, 'not-there') },
    ],
  });
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.targets).map(([id, tally]) => [id, [tally.bytes, tally.files]])),
    { uploads: [150, 2], db: [400, 1], wal: [30, 1], missing: [0, 0] },
  );
  assert.deepEqual([result.other.bytes, result.other.files], [7, 1]);
  assert.equal(result.total.bytes, 587);
  const sum = Object.values(result.targets).reduce((bytes, tally) => bytes + tally.knownBytes, result.other.knownBytes);
  assert.equal(sum, result.total.knownBytes);
});

test('a WAL file is not counted as its database, though its name starts with the database name', async () => {
  const root = await tempTree();
  await write(root, 'chat.db', 10);
  await write(root, 'chat.db-shm', 3);
  const result = await measureStorageTree({ root, targets: [{ id: 'main', path: path.join(root, 'chat.db') }] });
  assert.equal(result.targets.main!.bytes, 10);
  assert.equal(result.other.bytes, 3);
});

test('a symlink is not followed', async () => {
  const root = await tempTree();
  const outside = await tempTree();
  await write(outside, 'huge.bin', 5000);
  await write(root, 'uploads/real.png', 20);
  await fs.symlink(outside, path.join(root, 'uploads', 'link-to-dir'));
  await fs.symlink(path.join(outside, 'huge.bin'), path.join(root, 'link-to-file'));
  const result = await measureStorageTree({ root, targets: [{ id: 'uploads', path: path.join(root, 'uploads') }] });
  assert.equal(result.total.bytes, 20);
  assert.deepEqual(result.targets.uploads!.skippedSymlinks, [path.join(root, 'uploads', 'link-to-dir')]);
  assert.deepEqual(result.other.skippedSymlinks, [path.join(root, 'link-to-file')]);
  assert.deepEqual(result.total.skippedSymlinks.length, 2);
});

test('a symlinked root is not followed either', async () => {
  const real = await tempTree();
  await write(real, 'a.bin', 99);
  const holder = await tempTree();
  const link = path.join(holder, 'site');
  await fs.symlink(real, link);
  const result = await measureStorageTree({ root: link, targets: [] });
  assert.equal(result.total.bytes, 0);
  assert.deepEqual(result.total.skippedSymlinks, [link]);
});

test('an unreadable folder is reported unknown, not 0', async () => {
  const root = await tempTree();
  await write(root, 'uploads/ok.png', 10);
  await write(root, 'uploads/locked/secret.png', 10);
  await write(root, 'themes/t.css', 5);
  const locked = path.join(root, 'uploads', 'locked');
  const result = await measureStorageTree(
    { root, targets: [{ id: 'uploads', path: path.join(root, 'uploads') }, { id: 'themes', path: path.join(root, 'themes') }] },
    { fs: deniedFs(new Set([`${locked}/`])) },
  );
  assert.equal(result.targets.uploads!.bytes, null);
  assert.equal(result.targets.uploads!.knownBytes, 10);
  assert.deepEqual(result.targets.uploads!.unknownPaths, [locked]);
  assert.equal(result.targets.themes!.bytes, 5, 'a sibling stays exact');
  assert.equal(result.total.bytes, null);
  assert.equal(result.total.knownBytes, 15);
});

test('an unreadable folder makes every target inside it unknown too', async () => {
  const root = await tempTree();
  await write(root, 'ops/shares/a.zip', 10);
  await write(root, 'ops/x.db', 10);
  const ops = path.join(root, 'ops');
  const result = await measureStorageTree(
    { root, targets: [{ id: 'shares', path: path.join(ops, 'shares') }] },
    { fs: deniedFs(new Set([`${ops}/`])) },
  );
  assert.equal(result.targets.shares!.bytes, null);
  assert.deepEqual(result.targets.shares!.unknownPaths, [ops]);
  assert.equal(result.other.bytes, null);
});

test('an unreadable file or root is unknown; a file that vanished mid-walk is simply gone', async () => {
  const root = await tempTree();
  const file = await write(root, 'uploads/a.png', 10);
  const gone = await write(root, 'uploads/b.png', 10);
  const real: StorageTreeFs = { lstat: target => fs.lstat(target), readdir: target => fs.readdir(target) };
  const flaky: StorageTreeFs = {
    readdir: real.readdir,
    lstat: async target => {
      if (target === file) throw Object.assign(new Error('EIO'), { code: 'EIO' });
      if (target === gone) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return real.lstat(target);
    },
  };
  const result = await measureStorageTree({ root, targets: [] }, { fs: flaky });
  assert.equal(result.other.bytes, null);
  assert.deepEqual(result.other.unknownPaths, [file]);
  assert.equal(result.other.files, 0);
  const deniedRoot = await measureStorageTree({ root, targets: [] }, { fs: deniedFs(new Set([root])) });
  assert.equal(deniedRoot.total.bytes, null);
  assert.deepEqual(deniedRoot.total.unknownPaths, [root]);
});

test('a missing root measures as empty, not unknown', async () => {
  const root = path.join(await tempTree(), 'never-created');
  const result = await measureStorageTree({ root, targets: [{ id: 'a', path: path.join(root, 'a') }] });
  assert.equal(result.total.bytes, 0);
  assert.equal(result.targets.a!.bytes, 0);
});

test('special files such as sockets are listed by nobody and counted as nothing', async () => {
  const root = await tempTree();
  const fifo: StorageTreeFs = {
    readdir: async () => ['pipe'],
    lstat: async target => (target === root
      ? fs.lstat(root)
      : { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => false, size: 123 }),
  };
  const result = await measureStorageTree({ root, targets: [] }, { fs: fifo });
  assert.equal(result.total.bytes, 0);
  assert.equal(result.total.files, 0);
});

test('relative, duplicate or outside targets are refused in plain words', async () => {
  const root = await tempTree();
  await assert.rejects(measureStorageTree({ root: 'relative', targets: [] }), { name: 'TypeError', message: 'The folder to measure must be an absolute path: relative' });
  await assert.rejects(measureStorageTree({ root, targets: [{ id: 'a', path: 'uploads' }] }), { name: 'TypeError', message: 'Storage target "a" must be an absolute path: uploads' });
  await assert.rejects(
    measureStorageTree({ root, targets: [{ id: 'a', path: path.join(root, 'x') }, { id: 'a', path: path.join(root, 'y') }] }),
    { name: 'TypeError', message: 'Storage target "a" is listed twice.' },
  );
  await assert.rejects(
    measureStorageTree({ root, targets: [{ id: 'a', path: path.join(root, 'x') }, { id: 'b', path: path.join(root, 'x', '.') }] }),
    { name: 'TypeError', message: `Storage targets "a" and "b" name the same path: ${path.join(root, 'x')}` },
  );
  await assert.rejects(
    measureStorageTree({ root, targets: [{ id: 'a', path: path.join(path.dirname(root), 'elsewhere') }] }),
    { name: 'RangeError', message: `Storage target "a" is outside the folder being measured: ${path.join(path.dirname(root), 'elsewhere')}` },
  );
});

test('nested targets: the closest target owns a file', async () => {
  const root = await tempTree();
  await write(root, 'ops/shares/a.zip', 10);
  await write(root, 'ops/log.txt', 4);
  const result = await measureStorageTree({
    root,
    targets: [{ id: 'ops', path: path.join(root, 'ops') }, { id: 'shares', path: path.join(root, 'ops', 'shares') }],
  });
  assert.equal(result.targets.ops!.bytes, 4);
  assert.equal(result.targets.shares!.bytes, 10);
  assert.equal(result.total.bytes, 14);
});
