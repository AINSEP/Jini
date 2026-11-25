import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBundledImportPluginIds, readBundledPackageFiles, type CreateBundledSourceArchiveReader, type PackBundledSourceDirectory } from '../package-file-inventory.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function sourceRoot(folders: string[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'inventory-'));
  roots.push(root);
  for (const folder of folders) await mkdir(path.join(root, folder));
  await writeFile(path.join(root, 'stray-file.txt'), 'not a folder');
  return root;
}
/** Fake packer: the "archive" is the folder name; its digest is derived from it. */
const pack: PackBundledSourceDirectory = async ({ sourceDir }) => ({ sha256: `digest-${path.basename(sourceDir)}`, bytes: Buffer.from(path.basename(sourceDir)) });
const reader: CreateBundledSourceArchiveReader = () => ({
  async *entries({ archive }) {
    const name = Buffer.from(archive).toString();
    yield { kind: 'directory', entryPath: `${name}/`, openReadStream: async function* () { yield Buffer.from('ignored'); } };
    yield { kind: 'file', entryPath: 'a.txt', openReadStream: async function* () { yield Buffer.from(name); yield Buffer.from('-tail'); } };
  },
});
const hex = (text: string) => createHash('sha256').update(text).digest('hex');

describe('readBundledPackageFiles', () => {
  it('maps each packed folder digest to its file hashes, skipping non-folders and non-files', async () => {
    const root = await sourceRoot(['alpha', 'beta']);
    const inventory = await readBundledPackageFiles({ sourceRoot: root, packAgentPluginDirectory: pack, createBundledSourceArchiveReader: reader });
    expect([...inventory.keys()].sort()).toEqual(['digest-alpha', 'digest-beta']);
    expect(inventory.get('digest-alpha')).toEqual(new Map([['a.txt', hex('alpha-tail')]]));
  });

  it('a folder that does not pack verifies nothing; ENOENT is silent, other failures warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = await sourceRoot(['good', 'gone', 'broken']);
    const flaky: PackBundledSourceDirectory = async required => {
      const name = path.basename(required.sourceDir);
      if (name === 'gone') throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      if (name === 'broken') throw new Error('bad pack');
      return pack(required);
    };
    const inventory = await readBundledPackageFiles({ sourceRoot: root, packAgentPluginDirectory: flaky, createBundledSourceArchiveReader: reader });
    expect([...inventory.keys()]).toEqual(['digest-good']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('Could not inspect a bundled package');
  });

  it('an absent source root is an empty inventory without a warning; an unreadable one warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const missing = path.join(tmpdir(), 'inventory-missing-' + Date.now());
    expect((await readBundledPackageFiles({ sourceRoot: missing, packAgentPluginDirectory: pack, createBundledSourceArchiveReader: reader })).size).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    const file = path.join(await sourceRoot([]), 'stray-file.txt');
    expect((await readBundledPackageFiles({ sourceRoot: file, packAgentPluginDirectory: pack, createBundledSourceArchiveReader: reader })).size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('readBundledImportPluginIds', () => {
  it('returns the ids of the injected catalog reader for the injected root', async () => {
    const seen: string[] = [];
    const ids = await readBundledImportPluginIds({ sourceRoot: '/root-x', listBundledAgentPluginServers: async ({ bundledSourceRoot }) => { seen.push(bundledSourceRoot); return [{ pluginId: 'p1' }, { pluginId: 'p2' }, { pluginId: 'p1' }]; } });
    expect([...ids].sort()).toEqual(['p1', 'p2']);
    expect(seen).toEqual(['/root-x']);
  });
});
