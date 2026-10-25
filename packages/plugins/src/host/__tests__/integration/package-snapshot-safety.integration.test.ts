/** L2 §8.3: package-safety limits on the bounded snapshot — hard links, symlinks (file and root),
 *  and every size/entry limit exactly at and one past the edge; each refusal asserts its code. */
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PluginInstallError, snapshotSitePluginPackage } from '../../node/install.js';

let root: string;
let pkg: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'jini-snapshot-')); pkg = path.join(root, 'pkg'); await mkdir(pkg); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const refusal = async (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error);
const expectCode = async (promise: Promise<unknown>, code: string, message?: string) => {
  const error = await refusal(promise);
  expect(error).toBeInstanceOf(PluginInstallError);
  expect(error).toMatchObject({ code, ...(message ? { message } : {}) });
};

describe('links are refused', () => {
  it('a hard-linked file (nlink 2), even when both names are inside the package', async () => {
    await writeFile(path.join(pkg, 'a.txt'), 'x');
    await link(path.join(pkg, 'a.txt'), path.join(pkg, 'b.txt'));
    await expectCode(snapshotSitePluginPackage({ sourceDir: pkg }), 'PLUGIN_PACKAGE_UNSAFE', 'Only regular files without hard links are allowed.');
  });
  it('a hard link to a file OUTSIDE the package', async () => {
    await writeFile(path.join(root, 'secret'), 's');
    await link(path.join(root, 'secret'), path.join(pkg, 'innocent.txt'));
    await expectCode(snapshotSitePluginPackage({ sourceDir: pkg }), 'PLUGIN_PACKAGE_UNSAFE');
  });
  it('a symlinked file, even pointing inside', async () => {
    await writeFile(path.join(pkg, 'a.txt'), 'x');
    await symlink('a.txt', path.join(pkg, 'l.txt'));
    await expectCode(snapshotSitePluginPackage({ sourceDir: pkg }), 'PLUGIN_PACKAGE_UNSAFE', 'Symbolic links are not allowed.');
  });
  it('a symlinked package root', async () => {
    await symlink(pkg, path.join(root, 'alias'));
    await expectCode(snapshotSitePluginPackage({ sourceDir: path.join(root, 'alias') }), 'PLUGIN_PACKAGE_UNSAFE', 'Package directories must not be symbolic links.');
  });
});

describe('limits: exactly at passes, one past refuses', () => {
  it('maxFileBytes', async () => {
    await writeFile(path.join(pkg, 'f'), '0123456789');
    await expect(snapshotSitePluginPackage({ sourceDir: pkg }, { maxFileBytes: 10 })).resolves.toBeInstanceOf(Map);
    await expectCode(snapshotSitePluginPackage({ sourceDir: pkg }, { maxFileBytes: 9 }), 'PLUGIN_PACKAGE_TOO_LARGE', 'Package exceeds the file or total size limit.');
  });
  it('maxTotalBytes across files', async () => {
    await writeFile(path.join(pkg, 'a'), '12345');
    await writeFile(path.join(pkg, 'b'), '123456');
    const ok = await snapshotSitePluginPackage({ sourceDir: pkg }, { maxTotalBytes: 11 });
    expect([...ok.keys()]).toEqual(['a', 'b']);
    await expectCode(snapshotSitePluginPackage({ sourceDir: pkg }, { maxTotalBytes: 10 }), 'PLUGIN_PACKAGE_TOO_LARGE');
  });
  it('maxEntries counts directories too', async () => {
    await mkdir(path.join(pkg, 'd'));
    await writeFile(path.join(pkg, 'd', 'x'), '1');
    await writeFile(path.join(pkg, 'y'), '2');
    const ok = await snapshotSitePluginPackage({ sourceDir: pkg }, { maxEntries: 3 });
    expect(ok.entryCount).toBe(3);
    expect([...ok.keys()]).toEqual(['d/x', 'y']);
    await expectCode(snapshotSitePluginPackage({ sourceDir: pkg }, { maxEntries: 2 }), 'PLUGIN_PACKAGE_TOO_LARGE', 'Package has too many entries.');
  });
  it('an empty file and an empty directory are retained/counted', async () => {
    await writeFile(path.join(pkg, 'empty'), '');
    await mkdir(path.join(pkg, 'hollow'));
    const ok = await snapshotSitePluginPackage({ sourceDir: pkg }, { maxFileBytes: 1, maxTotalBytes: 1 });
    expect(ok.get('empty')?.length).toBe(0);
    expect(ok.entryCount).toBe(2);
  });
  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('limit %s is refused as PLUGIN_SNAPSHOT_LIMIT_INVALID', async (value) => {
    for (const key of ['maxEntries', 'maxFileBytes', 'maxTotalBytes']) {
      await expectCode(snapshotSitePluginPackage({ sourceDir: pkg }, { [key]: value }), 'PLUGIN_SNAPSHOT_LIMIT_INVALID', 'Snapshot limits must be positive safe integers.');
    }
  });
});
