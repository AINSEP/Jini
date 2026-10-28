import { afterEach, describe, expect, it, vi } from 'vitest';
import * as filesystem from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverPlugins, MAX_SITE_MANIFEST_BYTES, PluginDiscoveryVersionError } from '../../node/discovery.js';
import { PLUGIN_MANIFEST_FILENAME } from '../../plugin-format.js';
import { manifestHost, tierPolicy } from '../support/fixture-bindings.js';

// A spyable namespace over the real filesystem; the fault case replaces only open().
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual };
});

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
  it('C24: a stray copy cannot invalidate the plugin whose id its manifest claims', async () => {
    const dir = await installDir();
    await put(dir, 'seo', '1.0.0');
    await put(dir, 'seo-bak', '1.0.0', JSON.stringify(manifest('seo', '1.0.0')));

    const records = await discover(dir);
    expect(records.map(({ id, status, manifest: validated }) => ({ id, status, hasManifest: validated !== undefined }))).toEqual([
      { id: 'seo', status: 'valid', hasManifest: true },
      { id: 'seo-bak', status: 'invalid', hasManifest: false },
    ]);
    expect(records[0]!.errors).toEqual([]);
  });

  it('C25: a manifest version must match its installed version folder', async () => {
    const dir = await installDir();
    await put(dir, 'demo', '2.0.0', JSON.stringify(manifest('demo', '1.0.0')));

    const [record] = await discover(dir);
    expect(record!.status).toBe('invalid');
    expect(record!.errors.length).toBeGreaterThan(0);
    expect(record!.manifest).toBeUndefined();
  });

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
    await put(dir, 'locked', '1.0.0');
    const lockedPath = path.join(dir, 'locked', '1.0.0', PLUGIN_MANIFEST_FILENAME);
    const open = filesystem.open;
    // chmod cannot produce EACCES for root; inject the fault at the actual filesystem boundary.
    const fault = Object.assign(new Error('manifest access denied'), { code: 'EACCES' });
    const denied = vi.spyOn(filesystem, 'open').mockImplementation(async (...args) => {
      if (String(args[0]) === lockedPath) throw fault;
      return open(...args);
    });
    try {
      await expect(discover(dir)).rejects.toMatchObject({ code: 'EACCES' });
      expect(denied).toHaveBeenCalledWith(lockedPath, expect.any(Number));
    } finally { denied.mockRestore(); }
  });

  // A manifest is a small regular file. One plugin's odd manifest makes that plugin invalid; it never
  // hangs, bloats or aborts discovery for every other plugin (boot runs this too).
  it('a manifest that is a folder or a symlink makes only that plugin invalid', async () => {
    const dir = await installDir();
    await put(dir, 'fine', '1.0.0');
    await mkdir(path.join(dir, 'folder-manifest', '1.0.0', PLUGIN_MANIFEST_FILENAME), { recursive: true });
    await put(dir, 'target', '1.0.0');
    await mkdir(path.join(dir, 'linked', '1.0.0'), { recursive: true });
    await symlink(path.join(dir, 'target', '1.0.0', PLUGIN_MANIFEST_FILENAME), path.join(dir, 'linked', '1.0.0', PLUGIN_MANIFEST_FILENAME));
    const records = await discover(dir);
    expect(records.map(({ id, status, errors }) => [id, status, errors.map(error => error.code)])).toEqual([
      ['fine', 'valid', []], ['folder-manifest', 'invalid', ['MANIFEST_UNREADABLE']], ['linked', 'invalid', ['MANIFEST_UNREADABLE']], ['target', 'valid', []],
    ]);
  });

  it.skipIf(process.platform === 'win32')('j1: a FIFO manifest makes the plugin invalid instead of hanging discovery', async () => {
    const dir = await installDir();
    const fifo = path.join(dir, 'fifo', '1.0.0', PLUGIN_MANIFEST_FILENAME);
    await mkdir(path.dirname(fifo), { recursive: true });
    execFileSync('mkfifo', [fifo]);
    const outcome = await Promise.race([discover(dir), new Promise<'hung'>(resolve => setTimeout(() => resolve('hung'), 2000))]);
    // A blocked reader holds a libuv thread; one writer releases it so the test worker can exit.
    if (outcome === 'hung') await writeFile(fifo, '{}');
    expect(outcome).not.toBe('hung');
    expect((outcome as Awaited<ReturnType<typeof discover>>).map(({ status, errors }) => [status, errors.map(error => error.code)])).toEqual([['invalid', ['MANIFEST_UNREADABLE']]]);
  });

  it('j2: a manifest over the size cap is refused before it is read', async () => {
    const dir = await installDir();
    await put(dir, 'huge', '1.0.0', JSON.stringify({ ...manifest('huge', '1.0.0'), padding: 'x'.repeat(2 * 1024 * 1024) }));
    await put(dir, 'edge', '1.0.0', JSON.stringify(manifest('edge', '1.0.0')).padEnd(MAX_SITE_MANIFEST_BYTES, ' '));
    const records = await discover(dir);
    expect(records.map(({ id, status, errors }) => [id, status, errors.map(error => error.code)])).toEqual([
      ['edge', 'valid', []], ['huge', 'invalid', ['MANIFEST_UNREADABLE']],
    ]);
  });
});
