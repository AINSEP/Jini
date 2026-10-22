import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PLUGIN_MANIFEST_FILENAME, LEGACY_PLUGIN_MANIFEST_FILENAME } from '../../plugin-format.js';
import type { PluginManifest } from '../../manifest.js';
import { discoverPlugins } from '../../node/discovery.js';
import { computePluginIntegrity, installSitePlugin, previewSitePluginInstall } from '../../node/install.js';
import { snapshotPluginModuleGraph } from '../../node/module-snapshot.js';
import { manifestHost } from '../support/fixture-bindings.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const manifest = (name = 'Canonical'): PluginManifest => ({
  id: 'sample', name, version: '1.0.0', engine: 1, sdkRange: '^0.1.0', tier: 'tier-1',
  capabilities: [], hooks: [], fields: [], integrity: {},
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'plugin-format-')); roots.push(root);
  const installDir = path.join(root, 'plugins');
  const sourceDir = path.join(root, 'source'); await mkdir(sourceDir);
  const versionDir = path.join(installDir, 'sample', '1.0.0'); await mkdir(installDir);
  const deps = { ...manifestHost, installDir, builtInIds: [], repo: { listAll: async () => [] },
    conflicts: async () => [], archiveReader: async () => new Map<string, Uint8Array>(),
    tierPolicy: { siteErrors: () => [], checkInstall: () => {}, allowLoad: () => true, execution: 'in-process' as const } };
  return { deps, sourceDir, versionDir };
}

it('discovery reads a legacy manifest and the canonical manifest wins when both exist', async () => {
  const f = await fixture();
  await mkdir(f.versionDir, { recursive: true });
  await writeFile(path.join(f.versionDir, LEGACY_PLUGIN_MANIFEST_FILENAME), JSON.stringify(manifest('Legacy'))); // legacy alias
  const discover = () => discoverPlugins({ ...f.deps, builtIns: [] });
  expect((await discover()).map(record => [record.name, record.status])).toEqual([['Legacy', 'valid']]);
  await writeFile(path.join(f.versionDir, PLUGIN_MANIFEST_FILENAME), JSON.stringify(manifest()));
  expect((await discover()).map(record => [record.name, record.status])).toEqual([['Canonical', 'valid']]);
  await writeFile(path.join(f.versionDir, PLUGIN_MANIFEST_FILENAME), '{');
  expect((await discover())[0]!.errors).toContainEqual({ code: 'MANIFEST_MALFORMED', file: null, message: `${PLUGIN_MANIFEST_FILENAME} must be a JSON object` });
});

it.each(['legacy', 'both', 'canonical'])('install reads %s manifests but writes only the canonical filename', async kind => {
  const f = await fixture();
  if (kind !== 'canonical') await writeFile(path.join(f.sourceDir, LEGACY_PLUGIN_MANIFEST_FILENAME), JSON.stringify(manifest('Legacy'))); // legacy alias
  if (kind !== 'legacy') await writeFile(path.join(f.sourceDir, PLUGIN_MANIFEST_FILENAME), JSON.stringify(manifest()));
  const preview = await previewSitePluginInstall({ sourceDir: f.sourceDir, deps: f.deps });
  expect(preview.name).toBe(kind === 'legacy' ? 'Legacy' : 'Canonical');
  await installSitePlugin({ sourceDir: f.sourceDir, expectedDigest: preview.digest, deps: f.deps });
  expect(await readdir(f.versionDir)).toEqual([PLUGIN_MANIFEST_FILENAME]);
  expect(JSON.parse(await readFile(path.join(f.versionDir, PLUGIN_MANIFEST_FILENAME), 'utf8')).name).toBe(preview.name);
});

it('install rejects an invalid canonical manifest even when the legacy manifest is valid', async () => {
  const f = await fixture();
  await writeFile(path.join(f.sourceDir, LEGACY_PLUGIN_MANIFEST_FILENAME), JSON.stringify(manifest())); // legacy alias
  await writeFile(path.join(f.sourceDir, PLUGIN_MANIFEST_FILENAME), '{');
  await expect(previewSitePluginInstall({ sourceDir: f.sourceDir, deps: f.deps })).rejects.toMatchObject({ code: 'PLUGIN_MANIFEST_INVALID', message: `A valid ${PLUGIN_MANIFEST_FILENAME} is required.` });
});

it('legacy installed manifests still reserve their publisher identity', async () => {
  const f = await fixture();
  const qualified = { ...manifest(), extensions: { vendor: { id: 'vendor/sample' } } };
  await mkdir(f.versionDir, { recursive: true });
  await writeFile(path.join(f.versionDir, LEGACY_PLUGIN_MANIFEST_FILENAME), JSON.stringify(qualified)); // legacy alias
  await writeFile(path.join(f.sourceDir, PLUGIN_MANIFEST_FILENAME), JSON.stringify({ ...qualified, id: 'other' }));
  await expect(previewSitePluginInstall({ sourceDir: f.sourceDir, deps: { ...f.deps, identityNamespace: 'vendor' } })).rejects.toMatchObject({ code: 'PLUGIN_ID_CONFLICT' });
});

it('integrity generation and runtime snapshots exclude both manifest filenames', async () => {
  const f = await fixture();
  await mkdir(f.versionDir, { recursive: true });
  await writeFile(path.join(f.versionDir, PLUGIN_MANIFEST_FILENAME), JSON.stringify(manifest()));
  await writeFile(path.join(f.versionDir, LEGACY_PLUGIN_MANIFEST_FILENAME), '{'); // legacy alias
  await mkdir(path.join(f.versionDir, 'server'));
  await writeFile(path.join(f.versionDir, 'server/index.mjs'), 'export default 1;');
  const integrity = await computePluginIntegrity({ sourceDir: f.versionDir });
  expect(Object.keys(integrity)).toEqual(['server/index.mjs']);
  const entry = await snapshotPluginModuleGraph({ pluginRoot: f.versionDir, manifest: { ...manifest(), integrity } });
  expect(await readFile(entry, 'utf8')).toBe('export default 1;');
  expect((await readdir(path.dirname(path.dirname(entry)))).sort()).toEqual([PLUGIN_MANIFEST_FILENAME, LEGACY_PLUGIN_MANIFEST_FILENAME, 'server'].sort()); // legacy alias
});

it('canonicalizing a package with no manifest leaves it without one, so the validator reports the absence', async () => {
  const { canonicalizePluginManifest } = await import('../../plugin-format.js');
  const files = new Map([['server/index.mjs', 'export default {}']]);
  const canonical = canonicalizePluginManifest({ files });
  expect([...canonical.entries()]).toEqual([['server/index.mjs', 'export default {}']]);
  expect(canonical).not.toBe(files);
});
