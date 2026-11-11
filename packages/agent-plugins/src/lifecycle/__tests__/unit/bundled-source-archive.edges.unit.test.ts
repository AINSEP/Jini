/**
 * @file Edges of the bundled source archive: files are packed in sorted order whatever the directory
 * listing order, the 2048-file cap at 2048/2049, a magic-only archive is valid and empty while a
 * shorter one is refused, and entry headers are anchored at both ends. Closes Stryker run-2 survivors
 * at bundled-source-archive.ts:82, 83, 125, 135. Fake filesystem port (no disk).
 */
import { describe, expect, test } from 'vitest';
import { createBundledSourceArchiveModule } from '../../bundled-source-archive.js';
import type { AgentPluginLifecyclePorts, FilesystemPort } from '../../ports.js';
import { ports } from '../test-support.js';

const file = (name: string) => ({ name, isDirectory: () => false, isFile: () => true });
function moduleWith(names: readonly string[]) {
  const filesystem = {
    ...ports.filesystem,
    readdir: (async () => names.map(file)) as unknown as FilesystemPort['readdir'],
    readFile: (async (filename: string) => Buffer.from(`content of ${filename.split('/').pop()}`)) as unknown as FilesystemPort['readFile'],
  } as FilesystemPort;
  return createBundledSourceArchiveModule({ ...ports, filesystem } as AgentPluginLifecyclePorts);
}
const MAGIC = Buffer.from(ports.bundledArchiveMagic, 'utf8');
async function readAll(archive: Uint8Array) {
  const out: string[] = [];
  for await (const entry of moduleWith([]).createBundledSourceArchiveReader().entries({ archive })) out.push(entry.entryPath);
  return out;
}

describe('packAgentPluginDirectory', () => {
  test('packs files in sorted order whatever order the directory lists them', async () => {
    const packed = await moduleWith(['c.md', 'a.md', 'b.md']).packAgentPluginDirectory('/src');
    expect(packed.files).toEqual(['a.md', 'b.md', 'c.md']);
    expect(await readAll(packed.bytes)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  test('2048 files are packed; 2049 are refused with the count', async () => {
    const names = (count: number) => Array.from({ length: count }, (_, i) => `f${i}.md`);
    expect((await moduleWith(names(2048)).packAgentPluginDirectory('/src')).files).toHaveLength(2048);
    await expect(moduleWith(names(2049)).packAgentPluginDirectory('/src'))
      .rejects.toThrow("bundled agent plugin at '/src' has 2049 files, over the 2048-file cap — is this the right directory?");
  });
});

describe('bundled archive reader', () => {
  test('an archive that is exactly the magic is valid and has no entries', async () => {
    expect(await readAll(new Uint8Array(MAGIC))).toEqual([]);
  });

  test('an archive shorter than the magic is refused as bad magic', async () => {
    await expect(readAll(new Uint8Array(MAGIC.subarray(0, MAGIC.length - 1)))).rejects.toThrow('bundled agent plugin archive: bad magic');
  });

  test.each(['xF 1 1', 'F 1 1x', ' F 1 1', 'F 1 1 ', 'F a 1'])('entry header %j is malformed', async (header) => {
    const archive = Buffer.concat([MAGIC, Buffer.from(`${header}\na1`)]);
    await expect(readAll(new Uint8Array(archive))).rejects.toThrow(`bundled agent plugin archive: malformed entry header '${header}'`);
  });
});
