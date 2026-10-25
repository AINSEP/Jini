import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  createPluginContributionRegistry, createPluginProviderHost, type ManifestHostPorts, type PluginSdkBinding,
  type PluginManifest, type PluginTierPolicy,
} from '@jini-ai/plugins/host';
import { buildProviderPlugins } from '../../scripts/build.js';
import { previewSitePluginInstall, installSitePlugin, loadPlugin, snapshotPluginModuleGraph } from '@jini-ai/plugins/host/node';

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const binding: PluginSdkBinding = {
  hookIds: [], hookSemantics: {}, beforeSaveHook: 'unused', runtimeSdkVersion: '0.1.0',
  buildSdk: ({ sdk }) => sdk, definePlugin: definition => ({ definition }),
  readDefinedPlugin: ({ moduleValue }) => {
    const plugin = (moduleValue as { default?: ReturnType<PluginSdkBinding['definePlugin']> }).default;
    return plugin && typeof plugin.definition?.setup === 'function' ? plugin : null;
  },
};
const host: ManifestHostPorts = {
  identityNamespace: 'tovu', pluginSdkBinding: binding, capabilityVocabulary: ['providers.register'], coreOwnerName: 'host',
  declarativeContentTypes: {
    validateManifest: () => ({ errors: [] }), parse: () => ({ decls: [], errors: [] }),
    plan: async () => ({ conflicts: [], items: [] }), apply: async () => {},
  },
};
const tierPolicy: PluginTierPolicy = { execution: 'in-process', siteErrors: () => [], checkInstall: () => {}, allowLoad: ({ manifest }) => manifest.tier === 'tier-3' };

it('packs, installs and loads identical standalone bytes with both host SDK ABIs outside the workspace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'provider-artifact-')); roots.push(root);
  const outputRoot = path.join(root, 'distribution');
  const catalog = await buildProviderPlugins({ packageRoot }, { outputRoot });
  // Pack the exact publish file list, then install from extracted bytes. Build already ran above;
  // ignoring lifecycle here prevents npm from rerunning the build against this isolated staging dir.
  for (const filename of ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE']) await copyFile(path.join(packageRoot, filename), path.join(outputRoot, filename));
  const packed = await exec('npm', ['pack', '--ignore-scripts', '--json', '--cache', path.join(root, 'npm-cache')], { cwd: outputRoot });
  const [packedFile] = JSON.parse(packed.stdout) as Array<{ filename: string }>;
  const filename = packedFile!.filename;
  await exec('tar', ['-xzf', path.join(outputRoot, filename!), '-C', root]);
  const artifact = path.join(root, 'package', catalog[0]!.path);
  const manifest = JSON.parse(await readFile(path.join(artifact, 'jini.plugin.json'), 'utf8')) as PluginManifest;
  expect(manifest.integrity['server/index.mjs']).toMatch(/^sha256-[a-f0-9]{64}$/);
  expect(Object.keys(manifest.integrity).some(key => key.startsWith('licenses/'))).toBe(true);
  for (const [file, digest] of Object.entries(manifest.integrity)) {
    expect(`sha256-${createHash('sha256').update(await readFile(path.join(artifact, file))).digest('hex')}`).toBe(digest);
  }
  // A new Node process, rooted outside the repo with no NODE_PATH, can import the actual bytes.
  const standalone = await exec(process.execPath, ['--input-type=module', '-e', `
    const {default: plugin} = await import(${JSON.stringify(pathToFileURL(path.join(artifact, 'server/index.mjs')).href)});
    let provider; plugin.definition.setup({providers: {register(value) {provider = value;}}});
    const resource = await provider.factory({value: 'isolated'}, {});
    if (resource.port.read({}) !== 'isolated') throw new Error('standalone provider failed');
    await resource.dispose({});
    if (resource.port.read({}) !== undefined) throw new Error('resource was not disposed');
  `], { cwd: root, env: { ...process.env, NODE_PATH: '' } });
  expect(standalone.stderr).toBe('');
  for (const [namespace, runtimeSdkVersion] of [['tovu', '0.1.0'], ['com.example.host', '1.0.0']] as const) {
    const deps = { ...host, identityNamespace: namespace, tierPolicy, installDir: path.join(root, namespace, 'installed'), builtInIds: [],
      repo: { listAll: async () => [] }, conflicts: async () => [], archiveReader: async () => new Map<string, Uint8Array>(),
    };
    const preview = await previewSitePluginInstall({ sourceDir: artifact, deps });
    await installSitePlugin({ sourceDir: artifact, expectedDigest: preview.digest, deps });
    const installedRoot = path.join(deps.installDir, manifest.id, manifest.version);
    const registry = createPluginContributionRegistry({});
    const providerHost = createPluginProviderHost({ contributions: registry, contracts: [{ contract: 'fixture', validate: ({ provider }) => typeof (provider as { read?: unknown })?.read === 'function' ? undefined : 'missing read' }] });
    const loaded = await loadPlugin({ manifest, record: { id: manifest.id, name: manifest.name, version: manifest.version, source: 'site', status: 'valid', errors: [] },
      entryPath: path.join(installedRoot, 'server/index.mjs'), pluginSdkBinding: { ...binding, runtimeSdkVersion }, tierPolicy,
      verifyDigest: async ({ absoluteFilePath }) => `sha256-${createHash('sha256').update(await readFile(absoluteFilePath)).digest('hex')}`,
      importModule: async () => {
        const entry = await snapshotPluginModuleGraph({ pluginRoot: installedRoot, manifest });
        return { exported: (await import(pathToFileURL(entry).href)).default };
      },
      providerContributions: { registry, isSelected: () => true },
      coreDeps: { getCurrentEntry() { throw new Error('unused'); }, writeExtField() { throw new Error('unused'); }, attachFilter() { throw new Error('unused'); } },
    });
    expect(loaded).toEqual({ loaded: true });
    const lease = (await providerHost.initialize({ contract: 'fixture', id: 'fixture', input: { value: namespace } }))!;
    const port = lease.port as { read(required: Record<string, never>): unknown };
    expect(port.read({})).toBe(namespace);
    await providerHost.dispose({}); expect(port.read({})).toBeUndefined();
  }
});
