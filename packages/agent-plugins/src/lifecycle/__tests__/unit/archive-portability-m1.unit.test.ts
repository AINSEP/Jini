import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createAgentPluginLifecycle } from '../../index.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

// Model the Node ABI on platforms without these open flags; all filesystem work stays real.
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, constants: { ...actual.constants, O_NOFOLLOW: undefined, O_NONBLOCK: undefined } };
});

it('packs ordinary files without optional open flags and still rejects a file swapped after the walk', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'plugin-archive-m1-'));
  const sourceDir = path.join(root, 'source');
  const options = { limits: { maxEntries: 10, maxDepth: 2, maxFiles: 10, maxFileBytes: 100, maxTotalBytes: 100, maxArchiveBytes: 500 } };
  try {
    await fs.mkdir(sourceDir);
    await fs.writeFile(path.join(sourceDir, 'SKILL.md'), '# Safe');
    const api = createAgentPluginLifecycle({ ...ports });
    const packed = await api.packAgentPluginDirectory({ sourceDir }, options);
    const reader = api.createBundledSourceArchiveReader({});
    const entries: string[] = [];
    for await (const entry of reader.entries({ archive: packed.bytes })) {
      if (entry.kind !== 'file') throw new Error('Expected regular file');
      const chunks: Uint8Array[] = [];
      for await (const chunk of entry.openReadStream({})) chunks.push(chunk);
      entries.push(`${entry.entryPath}:${Buffer.concat(chunks).toString()}`);
    }
    expect(entries).toEqual(['SKILL.md:# Safe']);
    const other = path.join(root, 'other');
    await fs.writeFile(other, '# Untrusted');
    const open = (async (...args: Parameters<typeof fs.open>) => fs.open(other, args[1], args[2])) as typeof fs.open;
    const swapped = createAgentPluginLifecycle({ ...ports, filesystem: { ...ports.filesystem, open } });
    await expect(swapped.packAgentPluginDirectory({ sourceDir }, options)).rejects.toThrow("bundled agent plugin source is no longer a regular file: 'SKILL.md'");
  } finally { await forceRemove(root); }
});
