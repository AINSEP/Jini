import { afterAll, beforeAll, expect, it } from 'vitest';
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

/** Per plugin: the domain validator a host injects, and configuration whose initialization opens no connection. */
const SPECS: Record<string, { contract: string; id: string; validate: (port: unknown) => boolean; input: (namespace: string) => Record<string, unknown>; probe?: (port: unknown) => unknown }> = {
  'fixture-provider': { contract: 'fixture', id: 'fixture', validate: port => typeof (port as { read?: unknown })?.read === 'function', input: namespace => ({ value: namespace }),
    probe: port => (port as { read(required: Record<string, never>): unknown }).read({}) },
  'observability-opentelemetry': { contract: 'observability', id: 'opentelemetry', validate: port => typeof (port as { trackRequest?: unknown })?.trackRequest === 'function',
    input: () => ({ serviceName: 'artifact-test', tracerName: 'artifact', endpoint: 'http://127.0.0.1:9', headers: { authorization: 'Bearer unused' } }) },
  'observability-sentry': { contract: 'observability', id: 'sentry', validate: port => typeof (port as { reportError?: unknown })?.reportError === 'function',
    input: () => ({ dsn: 'https://public@sentry.invalid/1' }) },
};

let root: string;
let catalog: Awaited<ReturnType<typeof buildProviderPlugins>>;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'provider-artifact-'));
  const outputRoot = path.join(root, 'distribution');
  catalog = await buildProviderPlugins({ packageRoot }, { outputRoot });
  // Pack the exact publish file list, then install from extracted bytes. Build already ran above;
  // ignoring lifecycle here prevents npm from rerunning the build against this isolated staging dir.
  for (const filename of ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE']) await copyFile(path.join(packageRoot, filename), path.join(outputRoot, filename));
  const packed = await exec('npm', ['pack', '--ignore-scripts', '--json', '--cache', path.join(root, 'npm-cache')], { cwd: outputRoot });
  const [packedFile] = JSON.parse(packed.stdout) as Array<{ filename: string }>;
  await exec('tar', ['-xzf', path.join(outputRoot, packedFile!.filename), '-C', root]);
}, 120_000);
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

it('the catalog lists every plugin source, each with a spec here', () => {
  expect(catalog.map(entry => entry.id)).toEqual(Object.keys(SPECS).sort());
});

it.each(Object.keys(SPECS))('%s: packs, installs and loads identical standalone bytes with both host SDK ABIs outside the workspace', async (pluginId) => {
  const spec = SPECS[pluginId]!;
  const entry = catalog.find(value => value.id === pluginId)!;
  const artifact = path.join(root, 'package', entry.path);
  const manifest = JSON.parse(await readFile(path.join(artifact, 'jini.plugin.json'), 'utf8')) as PluginManifest;
  expect(manifest).toMatchObject({ id: pluginId, tier: 'tier-3', engine: 1, sdkRange: '^0.1.0 || ^1.0.0', capabilities: ['providers.register'],
    contributes: { providers: [{ contract: spec.contract, id: spec.id, contractVersion: 1 }] }, hooks: [], fields: [] });
  expect(manifest.integrity['server/index.mjs']).toMatch(/^sha256-[a-f0-9]{64}$/);
  expect(Object.keys(manifest.integrity).some(key => key.startsWith('licenses/'))).toBe(true);
  for (const [file, digest] of Object.entries(manifest.integrity)) {
    expect(`sha256-${createHash('sha256').update(await readFile(path.join(artifact, file))).digest('hex')}`).toBe(digest);
  }
  // A new Node process, rooted outside the repo with no NODE_PATH (so no vendor SDK is resolvable),
  // can import the actual bytes, register, initialize and dispose.
  const standalone = await exec(process.execPath, ['--input-type=module', '-e', `
    const {default: plugin} = await import(${JSON.stringify(pathToFileURL(path.join(artifact, 'server/index.mjs')).href)});
    let provider; plugin.definition.setup({providers: {register(value) {provider = value;}}});
    if (provider.contract !== ${JSON.stringify(spec.contract)} || provider.id !== ${JSON.stringify(spec.id)}) throw new Error('wrong provider');
    const resource = await provider.factory(${JSON.stringify(spec.input('standalone'))}, {});
    if (!resource.port) throw new Error('standalone provider failed');
    await resource.dispose({});
  `], { cwd: root, env: { ...process.env, NODE_PATH: '' } });
  expect(standalone.stderr).toBe('');
  for (const [namespace, runtimeSdkVersion] of [['tovu', '0.1.0'], ['com.example.host', '1.0.0']] as const) {
    const deps = { ...host, identityNamespace: namespace, tierPolicy, installDir: path.join(root, pluginId, namespace, 'installed'), builtInIds: [],
      repo: { listAll: async () => [] }, conflicts: async () => [], archiveReader: async () => new Map<string, Uint8Array>(),
    };
    const preview = await previewSitePluginInstall({ sourceDir: artifact, deps });
    await installSitePlugin({ sourceDir: artifact, expectedDigest: preview.digest, deps });
    const installedRoot = path.join(deps.installDir, manifest.id, manifest.version);
    const registry = createPluginContributionRegistry({});
    const providerHost = createPluginProviderHost({ contributions: registry, contracts: [{ contract: spec.contract, validate: ({ provider }) => spec.validate(provider) ? undefined : 'invalid port' }] });
    const loaded = await loadPlugin({ manifest, record: { id: manifest.id, name: manifest.name, version: manifest.version, source: 'site', status: 'valid', errors: [] },
      entryPath: path.join(installedRoot, 'server/index.mjs'), pluginSdkBinding: { ...binding, runtimeSdkVersion }, tierPolicy,
      verifyDigest: async ({ absoluteFilePath }) => `sha256-${createHash('sha256').update(await readFile(absoluteFilePath)).digest('hex')}`,
      importModule: async () => {
        const entryFile = await snapshotPluginModuleGraph({ pluginRoot: installedRoot, manifest });
        return { exported: (await import(pathToFileURL(entryFile).href)).default };
      },
      providerContributions: { registry, isSelected: () => true },
      coreDeps: { getCurrentEntry() { throw new Error('unused'); }, writeExtField() { throw new Error('unused'); }, attachFilter() { throw new Error('unused'); } },
    });
    expect(loaded).toEqual({ loaded: true });
    const lease = (await providerHost.initialize({ contract: spec.contract, id: spec.id, input: spec.input(namespace) }))!;
    expect(spec.validate(lease.port)).toBe(true);
    if (spec.probe) expect(spec.probe(lease.port)).toBe(namespace);
    await providerHost.dispose({});
    if (spec.probe) expect(spec.probe(lease.port)).toBeUndefined();
  }
}, 60_000);
