import { PLUGIN_MANIFEST_FILENAME } from '../../plugin-format.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, readFile, symlink, writeFile } from 'node:fs/promises';
import * as filesystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateManifest, type PluginManifest } from '../../manifest.js';
import { discoverPlugins } from '../../node/discovery.js';
import { previewSitePluginInstall, installSitePlugin } from '../../node/install.js';
import { manifestHost, pluginSdkBinding } from '../support/fixture-bindings.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const manifest = (id: string, publisherId?: string): PluginManifest => ({
  id, name: 'Repository plugin', version: '1.0.0', sdkRange: '^0.1.0', engine: 1, tier: 'tier-1',
  capabilities: [], hooks: [], fields: [], integrity: {}, keywords: ['repository'],
  ...(publisherId ? { extensions: { tovu: { id: publisherId, provides: ['source-control'] } } } : {}),
});

describe('site publisher identity shares the portable plugin contract', () => {
  it('validates and discovers only the identity namespace selected by the host', async () => {
    const host = { ...manifestHost, identityNamespace: 'vendor' };
    const candidate = (id: string): PluginManifest => ({ ...manifest(id), extensions: { vendor: { id: 'vendor/shared' }, tovu: { id: 'invalid' } } });
    const input = { manifest: candidate('first'), folderName: 'first', builtInIds: [] };
    expect(validateManifest({ ...host, ...input })).toEqual({ errors: [], warnings: [] });
    expect(validateManifest({ ...manifestHost, ...input }).errors).toEqual([{ code: 'PLUGIN_IDENTITY_INVALID', file: null, message: 'Plugin id must have the form publisher/name (lowercase letters, digits, dots and hyphens).' }]);
    const records = await discoverPlugins({ ...host, builtIns: [{ manifest: candidate('first') }, { manifest: candidate('second') }], tierPolicy: { siteErrors: () => [], checkInstall: () => {}, allowLoad: () => true, execution: 'in-process' } });
    expect(records.map(record => record.status)).toEqual(['valid', 'invalid']);
    expect(records[0]!.warnings).toEqual([]);
    expect(records[1]!.errors).toEqual([{ code: 'PLUGIN_ID_DUPLICATE', file: null, message: "duplicate publisher-qualified plugin id 'vendor/shared'" }]);
  });

  it('validates metadata without changing storage id or permission capabilities', () => {
    expect(validateManifest({ ...manifestHost, manifest: manifest('bridge', 'tovu/github'), folderName: 'bridge', builtInIds: [] })).toEqual({ errors: [], warnings: [] });
    const legacy = validateManifest({ ...manifestHost, manifest: manifest('bridge'), folderName: 'bridge', builtInIds: [] });
    expect(legacy.errors).toEqual([]);
    expect(legacy.warnings).toEqual(["Plugin 'bridge' has no publisher-qualified id; using 'unknown/bridge'."]);
    const invalid = validateManifest({ ...manifestHost, manifest: manifest('bridge', 'github'), folderName: 'bridge', builtInIds: [] });
    expect(invalid.errors).toEqual([{ code: 'PLUGIN_IDENTITY_INVALID', file: null, message: 'Plugin id must have the form publisher/name (lowercase letters, digits, dots and hyphens).' }]);
  });

  it('keeps the incumbent built-in valid and invalidates only the duplicate qualified id', async () => {
    const result = await discoverPlugins({ ...manifestHost, builtIns: [{ manifest: manifest('first', 'tovu/shared') }, { manifest: manifest('second', 'tovu/shared') }], tierPolicy: { siteErrors: () => [], checkInstall: () => {}, allowLoad: () => true, execution: 'in-process' }, pluginSdkBinding });
    expect(result.map(record => record.status)).toEqual(['valid', 'invalid']);
    expect(result.map(record => record.errors.some(error => error.code === 'PLUGIN_ID_DUPLICATE'))).toEqual([false, true]);
  });

  it('refuses a second install using an existing qualified id and a publisher takeover', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'site-plugin-identity-')); roots.push(root);
    const deps = { ...manifestHost, installDir: path.join(root, 'plugins'), builtInIds: [], repo: { listAll: async () => [] },
      conflicts: async () => [], archiveReader: async () => new Map<string, Uint8Array>(),
      tierPolicy: { siteErrors: () => [], checkInstall: () => {}, allowLoad: () => true, execution: 'in-process' as const } };
    async function source(id: string, publisherId?: string) {
      const sourceDir = path.join(root, 'sources', id + (publisherId ?? 'legacy').replace('/', '-'));
      await mkdir(sourceDir, { recursive: true });
      await writeFile(path.join(sourceDir, PLUGIN_MANIFEST_FILENAME), JSON.stringify(manifest(id, publisherId)));
      return sourceDir;
    }
    const legacy = await previewSitePluginInstall({ sourceDir: await source('legacy'), deps });
    expect(legacy.publisherId).toBe('unknown/legacy');
    expect(legacy.warnings).toEqual(["Plugin 'legacy' has no publisher-qualified id; using 'unknown/legacy'."]);
    const sourceDir = await source('github', 'tovu/github');
    const preview = await previewSitePluginInstall({ sourceDir, deps });
    expect(preview.publisherId).toBe('tovu/github');
    expect(preview.provides).toEqual(['source-control']);
    await installSitePlugin({ sourceDir, expectedDigest: preview.digest, deps });
    await expect(previewSitePluginInstall({ sourceDir: await source('alias', 'tovu/github'), deps })).rejects.toMatchObject({ code: 'PLUGIN_ID_CONFLICT' });
    await expect(previewSitePluginInstall({ sourceDir: await source('github', 'github/github'), replace: true, deps })).rejects.toMatchObject({ code: 'PLUGIN_ID_CONFLICT' });
  });
  it.each(['json', 'identity', 'missing'])('skips an unrelated broken %s manifest in preview and install', async kind => {
    const root = await mkdtemp(path.join(tmpdir(), 'site-plugin-broken-')); roots.push(root);
    const warnings: string[] = [];
    const deps = { ...manifestHost, warn: (message: string) => warnings.push(message), installDir: path.join(root, 'plugins'), builtInIds: [], repo: { listAll: async () => [] },
      conflicts: async () => [], archiveReader: async () => new Map<string, Uint8Array>(),
      tierPolicy: { siteErrors: () => [], checkInstall: () => {}, allowLoad: () => true, execution: 'in-process' as const } };
    const broken = path.join(deps.installDir, 'broken', '1.0.0');
    await mkdir(broken, { recursive: true });
    if (kind !== 'missing') await writeFile(path.join(broken, PLUGIN_MANIFEST_FILENAME), kind === 'json' ? '{' : JSON.stringify(manifest('broken', 'invalid')));
    const sourceDir = path.join(root, 'source'); await mkdir(sourceDir);
    await writeFile(path.join(sourceDir, PLUGIN_MANIFEST_FILENAME), JSON.stringify(manifest('healthy', 'tovu/healthy')));
    const preview = await previewSitePluginInstall({ sourceDir, deps });
    const installed = await installSitePlugin({ sourceDir, expectedDigest: preview.digest, deps });
    expect(installed.publisherId).toBe('tovu/healthy');
    expect(JSON.parse(await readFile(path.join(deps.installDir, 'healthy', '1.0.0', PLUGIN_MANIFEST_FILENAME), 'utf8')).id).toBe('healthy');
    expect(warnings.length).toBeGreaterThan(0);
    expect(new Set(warnings)).toEqual(new Set(["Plugin 'broken': installed identity manifest is unreadable or invalid; omitted from identity admission."]));
    // Resilience never weakens the existing no-links boundary.
    await rm(path.join(broken, PLUGIN_MANIFEST_FILENAME), { force: true });
    await symlink(path.join(sourceDir, PLUGIN_MANIFEST_FILENAME), path.join(broken, PLUGIN_MANIFEST_FILENAME));
    await expect(previewSitePluginInstall({ sourceDir, replace: true, deps })).rejects.toMatchObject({ code: 'PLUGIN_PACKAGE_UNSAFE' });
  });

  it('a site claimant cannot disable a built-in incumbent with the same publisher id', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'site-plugin-incumbent-')); roots.push(root);
    const version = path.join(root, 'aaa-claimant', '1.0.0'); await mkdir(version, { recursive: true });
    await writeFile(path.join(version, PLUGIN_MANIFEST_FILENAME), JSON.stringify(manifest('aaa-claimant', 'tovu/shared')));
    const records = await discoverPlugins({ ...manifestHost, installDir: root, builtIns: [{ manifest: manifest('zzz-incumbent', 'tovu/shared') }],
      tierPolicy: { siteErrors: () => [], checkInstall: () => {}, allowLoad: () => true, execution: 'in-process' }, pluginSdkBinding });
    expect(records.map(record => [record.id, record.status])).toEqual([['zzz-incumbent', 'valid'], ['aaa-claimant', 'invalid']]);
    expect(records[1]!.manifest).toBeUndefined();
    expect(records[1]!.errors).toEqual([{ code: 'PLUGIN_ID_DUPLICATE', file: null, message: "duplicate publisher-qualified plugin id 'tovu/shared'" }]);
  });

  it('refuses a built-in publisher identity under a different local id before publication', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'site-plugin-built-in-identity-')); roots.push(root);
    const deps = { ...manifestHost, installDir: path.join(root, 'plugins'), builtInIds: ['word-count'],
      builtInManifests: [manifest('word-count', 'vendor/word-count')], repo: { listAll: async () => [] },
      conflicts: async () => [], archiveReader: async () => new Map<string, Uint8Array>(),
      tierPolicy: { siteErrors: () => [], checkInstall: () => {}, allowLoad: () => true, execution: 'in-process' as const } };
    const sourceDir = path.join(root, 'source'); await mkdir(sourceDir);
    await writeFile(path.join(sourceDir, PLUGIN_MANIFEST_FILENAME), JSON.stringify(manifest('alias', 'vendor/word-count')));
    await expect(previewSitePluginInstall({ sourceDir, deps })).rejects.toMatchObject({ code: 'PLUGIN_ID_CONFLICT', message: 'The publisher-qualified plugin id conflicts with an installed package.' });
    await expect(installSitePlugin({ sourceDir, expectedDigest: 'unused', deps })).rejects.toMatchObject({ code: 'PLUGIN_ID_CONFLICT' });
    await expect(filesystem.readdir(deps.installDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    ['lstat', 'slot', 'ENOENT'], ['lstat', 'slot', 'EACCES'],
    ['readdir', 'slot', 'ENOENT'], ['readdir', 'slot', 'EACCES'],
    ['lstat', 'version', 'ENOENT'], ['lstat', 'version', 'EACCES'],
  ] as const)('isolates %s at an unrelated %s with %s during real installation', async (operation, target, code) => {
    const root = await mkdtemp(path.join(tmpdir(), 'site-plugin-slot-fault-')); roots.push(root);
    const installDir = path.join(root, 'plugins');
    const slot = path.join(installDir, 'broken');
    const version = path.join(slot, '1.0.0'); await mkdir(version, { recursive: true });
    const faultPath = target === 'slot' ? slot : version;
    const warnings: string[] = [];
    let faults = 0;
    const identityFilesystem = {
      ...filesystem,
      [operation]: (async (...args: Parameters<typeof filesystem.lstat>) => {
        if (String(args[0]) === faultPath) {
          faults++;
          throw Object.assign(new Error('Neighbour unavailable.'), { code });
        }
        return Reflect.apply(filesystem[operation], filesystem, args);
      }) as typeof filesystem.lstat & typeof filesystem.readdir,
    };
    const deps = { ...manifestHost, installDir, identityFilesystem, warn: (message: string) => warnings.push(message), builtInIds: [], repo: { listAll: async () => [] },
      conflicts: async () => [], archiveReader: async () => new Map<string, Uint8Array>(),
      tierPolicy: { siteErrors: () => [], checkInstall: () => {}, allowLoad: () => true, execution: 'in-process' as const } };
    const sourceDir = path.join(root, 'source'); await mkdir(sourceDir);
    await writeFile(path.join(sourceDir, PLUGIN_MANIFEST_FILENAME), JSON.stringify(manifest('healthy', 'vendor/healthy')));
    const preview = await previewSitePluginInstall({ sourceDir, deps });
    await installSitePlugin({ sourceDir, expectedDigest: preview.digest, deps });
    expect(JSON.parse(await readFile(path.join(installDir, 'healthy', '1.0.0', PLUGIN_MANIFEST_FILENAME), 'utf8')).extensions.tovu.id).toBe('vendor/healthy');
    expect(faults).toBe(3); // Preview, install inspection, and the locked admission recheck.
    expect(warnings).toEqual(Array(3).fill("Plugin 'broken': installed slot is unavailable; omitted from identity admission."));
  });

});
