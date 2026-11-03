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
