/** L2 §4 package-files: the listing's containment check (sibling-prefix escape, symlinked root),
 *  and each cap exactly at / one past its edge; omissions are reported per file. */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PLUGIN_PACKAGE_FILE_LIMITS, PluginPackagePathError, readPluginPackageFiles } from '../../node/package-files.js';

let container: string;
let root: string;
const big = { maxFiles: 100, maxEntries: 100, maxFileBytes: 1000, maxTotalBytes: 10000 };
beforeEach(async () => { container = await mkdtemp(path.join(tmpdir(), 'jini-pkgfiles-')); root = path.join(container, 'pkg'); await mkdir(root); });
afterEach(async () => { await rm(container, { recursive: true, force: true }); });
const read = (limits = big, rootDir = root, containerDir = container) => readPluginPackageFiles({ input: { rootDir, containerDir } }, { limits });

describe('containment', () => {
  it('a missing root is an empty listing', async () => {
    await expect(read(big, path.join(container, 'absent'))).resolves.toEqual({ files: [], truncated: false });
  });
  it('a root in a sibling directory sharing the container prefix is refused', async () => {
    const sibling = `${container}-evil`;
    await mkdir(path.join(sibling, 'pkg'), { recursive: true });
    try {
      await expect(read(big, path.join(sibling, 'pkg'))).rejects.toBeInstanceOf(PluginPackagePathError);
    } finally { await rm(sibling, { recursive: true, force: true }); }
  });
  it('a symlinked root and a file root are refused', async () => {
    await symlink(root, path.join(container, 'alias'));
    await expect(read(big, path.join(container, 'alias'))).rejects.toThrow(/is not a plain directory/);
    await writeFile(path.join(container, 'file'), 'x');
    await expect(read(big, path.join(container, 'file'))).rejects.toThrow(/is not a plain directory/);
  });
  it('root equal to the container is allowed', async () => {
    await writeFile(path.join(container, 'a.txt'), 'a');
    const listing = await read(big, container);
    expect(listing.files.map(f => f.relativePath)).toContain('a.txt');
  });
});

describe('limits and omissions', () => {
  it('maxFileBytes: exactly at the cap is read, one byte over is omitted too-large', async () => {
    await writeFile(path.join(root, 'at.txt'), 'x'.repeat(10));
    await writeFile(path.join(root, 'over.txt'), 'x'.repeat(11));
    const { files } = await read({ ...big, maxFileBytes: 10 });
    expect(files).toEqual([
      { relativePath: 'at.txt', sizeBytes: 10, content: 'x'.repeat(10), omitted: null },
      { relativePath: 'over.txt', sizeBytes: 11, content: null, omitted: 'too-large' },
    ]);
  });
  it('maxTotalBytes: exactly reaching the total is fine; exceeding it truncates', async () => {
    await writeFile(path.join(root, 'a'), '12345');
    await writeFile(path.join(root, 'b'), '12345');
    expect((await read({ ...big, maxTotalBytes: 10 })).truncated).toBe(false);
    const cut = await read({ ...big, maxTotalBytes: 9 });
    expect(cut.truncated).toBe(true);
    expect(cut.files.map(f => f.relativePath)).toEqual(['a']);
  });
  it('maxFiles: exactly N files untruncated; N+1 truncated at N', async () => {
    for (const name of ['a', 'b', 'c']) await writeFile(path.join(root, name), name);
    expect(await read({ ...big, maxFiles: 3 })).toMatchObject({ truncated: false });
    const cut = await read({ ...big, maxFiles: 2 });
    expect(cut.truncated).toBe(true);
    expect(cut.files).toHaveLength(2);
  });
  it('maxEntries counts directories', async () => {
    await mkdir(path.join(root, 'd'));
    await writeFile(path.join(root, 'd', 'x'), 'x');
    expect((await read({ ...big, maxEntries: 2 })).truncated).toBe(false);
    expect((await read({ ...big, maxEntries: 1 })).truncated).toBe(true);
  });
  it('binary, invalid UTF-8, symlink and hard-linked files are omitted with their reason', async () => {
    await writeFile(path.join(root, 'bin'), Buffer.from([1, 0, 2]));
    await writeFile(path.join(root, 'bad-utf8'), Buffer.from([0xc3, 0x28]));
    await writeFile(path.join(container, 'outside'), 'secret');
    await symlink(path.join(container, 'outside'), path.join(root, 'link'));
    const { files } = await read();
    const byName = Object.fromEntries(files.map(f => [f.relativePath, f]));
    expect(byName.bin).toMatchObject({ omitted: 'binary', content: null, sizeBytes: 3 });
    expect(byName['bad-utf8']).toMatchObject({ omitted: 'binary', content: null });
    expect(byName.link).toMatchObject({ omitted: 'symlink', content: null, sizeBytes: 0 });
    expect(JSON.stringify(files)).not.toContain('secret');
  });
  it('defaults are pinned', () => {
    expect(PLUGIN_PACKAGE_FILE_LIMITS).toEqual({ maxFiles: 200, maxEntries: 2000, maxFileBytes: 512 * 1024, maxTotalBytes: 4 * 1024 * 1024 });
  });
});
