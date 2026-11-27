import { expect, test } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sourceTreeStamp } from '../source-tree-stamp.js';

test('a prebuilt frontend becomes stale after an edit, addition, or deletion', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-stamp-'));
  try {
    const file = path.join(root, 'view.tsx');
    const empty = await sourceTreeStamp({ roots: [root] });
    await writeFile(file, 'first');
    const first = await sourceTreeStamp({ roots: [root] });
    await writeFile(file, 'second');
    const edited = await sourceTreeStamp({ roots: [root] });
    await rm(file);
    expect(new Set([empty, first, edited]).size).toBe(3);
    expect(await sourceTreeStamp({ roots: [root] })).toBe(empty);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing roots are tolerated, but a root beneath a regular file reports ENOTDIR', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-stamp-'));
  try {
    const missing = path.join(root, 'view.tsx');
    const before = await sourceTreeStamp({ roots: [missing] });
    await writeFile(missing, 'view source');
    expect(await sourceTreeStamp({ roots: [missing] })).not.toBe(before);
    await expect(sourceTreeStamp({ roots: [path.join(missing, 'child.ts')] }))
      .rejects.toMatchObject({ code: 'ENOTDIR' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('generated folders and changes to an external symlink target do not stale the bundle', async () => {
  const { mkdir, symlink } = await import('node:fs/promises');
  const temp = await mkdtemp(path.join(os.tmpdir(), 'source-stamp-'));
  try {
    const root = path.join(temp, 'src');
    const external = path.join(temp, 'external.ts');
    await mkdir(root);
    await writeFile(external, 'initial');
    await symlink(external, path.join(root, 'linked.ts'));
    const before = await sourceTreeStamp({ roots: [root] });
    for (const name of ['node_modules', 'dist', '.git']) {
      await mkdir(path.join(root, name));
      await writeFile(path.join(root, name, 'ignored.ts'), name);
    }
    await writeFile(external, 'updated');
    expect(await sourceTreeStamp({ roots: [root] })).toBe(before);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
