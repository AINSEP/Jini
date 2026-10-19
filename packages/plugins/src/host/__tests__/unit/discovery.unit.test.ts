import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverPlugins, PluginDiscoveryVersionError } from '../../node/discovery.js';
import { PLUGIN_MANIFEST_FILENAME } from '../../plugin-format.js';
import { manifestHost, tierPolicy } from '../support/fixture-bindings.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function installDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'plugin-discovery-')); roots.push(root);
  return path.join(root, 'plugins');
}
const manifest = (id: string, version: string) => ({
  id, name: id, version, sdkRange: '^0.1.0', engine: 1, tier: 'tier-1', capabilities: [], hooks: [], fields: [], integrity: {},
  extensions: { tovu: { id: `vendor/${id}` } },
});
async function put(dir: string, id: string, version: string, contents: string = JSON.stringify(manifest(id, version))): Promise<void> {
  await mkdir(path.join(dir, id, version), { recursive: true });
  await writeFile(path.join(dir, id, version, PLUGIN_MANIFEST_FILENAME), contents);
}
const discover = (dir: string, versions?: ReadonlyMap<string, string>) =>
  discoverPlugins({ ...manifestHost, tierPolicy, builtIns: [], installDir: dir }, versions ? { versions } : {});

describe('site discovery edges', () => {
  it('propagates an unreadable install folder, but treats a missing one as empty', async () => {
    const dir = await installDir();
    expect(await discover(dir)).toEqual([]);
    await writeFile(dir, 'not a folder');
    await expect(discover(dir)).rejects.toMatchObject({ code: 'ENOTDIR' });
  });

  it('skips id folders without versions and prefers semver over non-semver folder names', async () => {
    const dir = await installDir();
    await mkdir(path.join(dir, 'empty'), { recursive: true });
    await put(dir, 'mixed', '1.0.0');
    await mkdir(path.join(dir, 'mixed', '-old')); await mkdir(path.join(dir, 'mixed', 'abc')); await mkdir(path.join(dir, 'mixed', 'zzz'));
    await mkdir(path.join(dir, 'named', 'abc'), { recursive: true }); await mkdir(path.join(dir, 'named', 'zzz'));
    const records = await discover(dir);
    expect(records.map(record => [record.id, record.version])).toEqual([['mixed', '1.0.0'], ['named', 'zzz']]);
    expect(records[1]!.errors[0]!.code).toBe('MANIFEST_MISSING');
  });

  it('a pinned version is used as-is, and an unsafe pin is refused', async () => {
    const dir = await installDir();
    await put(dir, 'demo', '1.0.0'); await put(dir, 'demo', '2.0.0');
    expect((await discover(dir, new Map([['demo', '1.0.0']])))[0]!.version).toBe('1.0.0');
    await expect(discover(dir, new Map([['demo', 'nope']]))).rejects.toBeInstanceOf(PluginDiscoveryVersionError);
    await expect(discover(dir, new Map([['demo', '=1.0.0']]))).rejects.toMatchObject({ name: 'PluginDiscoveryVersionError' });
  });

  it('falls back to the folder name for a non-object manifest and rethrows non-ENOENT read faults', async () => {
    const dir = await installDir();
    await put(dir, 'scalar', '1.0.0', '"just a string"');
    await put(dir, 'typed', '1.0.0', JSON.stringify({ id: 5, name: 6 }));
    await put(dir, 'broken', '1.0.0', '{');
    expect((await discover(dir)).map(({ id, name, status, tier }) => ({ id, name, status, tier }))).toEqual(['broken', 'scalar', 'typed'].map(id => ({ id, name: id, status: 'invalid', tier: 'tier-3' })));
    await mkdir(path.join(dir, 'folder-manifest', '1.0.0', PLUGIN_MANIFEST_FILENAME), { recursive: true });
    await expect(discover(dir)).rejects.toMatchObject({ code: 'EISDIR' });
  });
});
