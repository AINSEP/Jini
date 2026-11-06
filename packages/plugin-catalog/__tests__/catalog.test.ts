/** Catalog metadata must correspond to real distribution subpaths without shipping their bytes. */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { catalogEntry, generateCatalog, type CatalogEntry } from '../scripts/generate.js';
import { AGENT_PLUGINS_PACKAGE, agentPluginPackages } from '../../../scripts/lib/agent-plugin-packages.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const packagesRoot = path.dirname(root);
const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const entries = await readJson(path.join(root, 'catalog.json')) as CatalogEntry[];
const agentPluginsPackage = await readJson(path.join(packagesRoot, 'agent-plugins/package.json'));
const digest = `sha256-${'a'.repeat(64)}`;

describe('standalone plugin catalog', () => {
  it('lists every provider source exactly once and each agent plugin package', async () => {
    const sources = await readdir(path.join(packagesRoot, 'provider-plugins/src'), { withFileTypes: true });
    const ids = sources.filter(item => item.isDirectory() && !item.name.startsWith('__')).map(item => item.name);
    const keys = (list: { kind: string; id: string }[]) => list.map(item => `${item.kind}:${item.id}`).sort();
    expect(keys(entries)).toEqual(keys([...ids.map(id => ({ kind: 'provider', id })),
      ...agentPluginPackages.map(row => ({ kind: 'agent', id: row.name }))]));
  });

  it.each(entries)('$kind $id matches its real package, publisher, path and contract', async entry => {
    const row = entry.kind === 'agent' ? agentPluginPackages.find(item => item.name === entry.id)! : undefined;
    const packageDir = row ? 'agent-plugins' : 'provider-plugins';
    const packageManifest = await readJson(path.join(packagesRoot, packageDir, 'package.json'));
    const source = row ? path.join(path.dirname(packagesRoot), row.sourceDir, 'plugin.json')
      : path.join(packagesRoot, `provider-plugins/src/${entry.id}/jini.plugin.json`);
    const pluginManifest = await readJson(source);
    expect(entry).toEqual({ ...catalogEntry({ id: entry.id, packageManifest, pluginManifest }, { kind: entry.kind, packageName: packageManifest.name }),
      expectedDigests: entry.expectedDigests });
    if (row) expect(`${entry.packageName}/${entry.path}`).toBe(`${AGENT_PLUGINS_PACKAGE}/${entry.id}`);
    // Jini's own plugins say jini/<id> (a chart face jini/<id>-agent); plugins moved from Tovu keep tovu/<id>.
    expect(entry.publisherIdentity).toMatch(new RegExp(`^(?:jini/${entry.id}(?:-agent)?|tovu/${entry.id})$`));
    expect(entry.path.startsWith('/')).toBe(false);
    expect(entry.path.split('/')).not.toContain('..');
  });

  it('preserves each agent manifest version independently of the npm release', () => {
    expect(entries.find(entry => entry.id === 'ui-ux-design')).toMatchObject({
      kind: 'agent', packageName: AGENT_PLUGINS_PACKAGE, version: agentPluginsPackage.version, pluginVersion: '0.6.2', path: 'ui-ux-design',
      contract: { id: 'agent-plugins', version: '1.0.0' },
    });
    expect(entries.find(entry => entry.id === 'slide-design')).toMatchObject({
      kind: 'agent', packageName: AGENT_PLUGINS_PACKAGE, version: agentPluginsPackage.version, pluginVersion: '0.1.0', path: 'slide-design',
      contract: { id: 'agent-plugins', version: '1.0.0' },
    });
  });

  it('ships both hosted form faces through independent shared-package subpaths with real integrity', () => {
    const provider = entries.find(entry => entry.id === 'google-forms' && entry.kind === 'provider');
    const agent = entries.find(entry => entry.id === 'google-forms' && entry.kind === 'agent');
    expect(provider).toMatchObject({ packageName: '@jini-ai/provider-plugins', publisherIdentity: 'jini/google-forms', contract: { id: 'form_collection', version: 1 } });
    expect(agent).toMatchObject({ packageName: AGENT_PLUGINS_PACKAGE, path: 'google-forms', publisherIdentity: 'jini/google-forms-agent' });
    expect(provider?.expectedDigests?.['server/index.mjs']).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(agent?.expectedDigests?.['skills/google-forms/SKILL.md']).toMatch(/^sha256-[a-f0-9]{64}$/);
  });

  it('has no dependencies, executable exports or install hooks', async () => {
    const pkg = await readJson(path.join(root, 'package.json'));
    for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies', 'bundledDependencies', 'bundleDependencies']) {
      expect(pkg[key]).toBeUndefined();
    }
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) expect(pkg.scripts[hook]).toBeUndefined();
    expect(pkg.exports).toEqual({ './catalog': './catalog.json', './package.json': './package.json' });
    expect(pkg.files).toEqual(['catalog.json', 'README.md', 'LICENSE', 'NOTICE']);
    expect(pkg.scripts.prepack).toBe('node --import tsx scripts/generate.ts');
  });

  it('packs only metadata and documentation into the actual npm tarball', async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), 'jini-catalog-pack-'));
    try {
      // Packing with hooks disabled isolates the file-list gate from artifact generation.
      execFileSync('npm', ['pack', root, '--ignore-scripts', '--pack-destination', temporary, '--cache', path.join(temporary, 'cache')]);
      const tarball = (await readdir(temporary)).find(name => name.endsWith('.tgz'))!;
      const files = execFileSync('tar', ['-tzf', path.join(temporary, tarball)], { encoding: 'utf8' }).trim().split('\n').sort();
      expect(files).toEqual(['LICENSE', 'NOTICE', 'README.md', 'catalog.json', 'package.json'].map(name => `package/${name}`).sort());
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
});

/** A completed provider payload fixture; all effects are ports, with no vendor code imported. */
function fixture() {
  const pluginManifest = { id: 'fixture-provider', name: 'Fixture', version: '0.6.12',
    extensions: { tovu: { id: 'jini/fixture-provider' } },
    contributes: { providers: [{ contract: 'fixture', contractVersion: 1 }] }, integrity: {} };
  const packageManifest = { name: '@jini-ai/provider-plugins', version: '0.6.17', description: 'Fixture' };
  const artifact = { ...pluginManifest, version: '0.6.17', integrity: { 'server/index.mjs': digest } };
  const ports = {
    readJson: async (file: string) => {
      if (file.endsWith('package.json')) return packageManifest;
      return file.includes('/src/') ? pluginManifest : artifact;
    },
    integrity: async () => ({ 'server/index.mjs': digest }),
  };
  return { pluginManifest, packageManifest, artifact, ports };
}

const designRow = { name: 'ui-ux-design', sourceDir: 'packages/agent-plugins/ui-ux-design' };

/** A browser-only chart provider shipped by provider-plugins (no plugin-<id> package) and its agent face,
 * an agent-plugins subpath, under the same local id. */
function combinedFixture() {
  const providerPackage = { name: '@jini-ai/provider-plugins', version: '0.6.19', description: 'Provider plugins' };
  const agentPackage = { name: '@jini-ai/agent-plugins', version: '0.6.19', description: 'Agent plugins' };
  const provider = { id: 'charts-fixture', name: 'Fixture charts', version: '0.6.12',
    extensions: { tovu: { id: 'jini/charts-fixture' } },
    browserProviders: [{ id: 'plugin.charts-fixture', kind: 'chart', contractVersion: 1, kinds: ['bar'], javascript: 'client/provider.js' }] };
  const integrity: Record<string, string> = { 'client/provider.js': digest };
  const providerArtifact = { ...provider, version: '0.6.19', integrity };
  const face = { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'charts-fixture', version: '0.1.0',
    extensions: { tovu: { id: 'jini/charts-fixture-agent' } } };
  const files: Record<string, unknown> = {
    '/packages/provider-plugins/package.json': providerPackage,
    '/packages/agent-plugins/package.json': agentPackage,
    '/packages/provider-plugins/src/charts-fixture/jini.plugin.json': provider,
    '/packages/provider-plugins/plugins/charts-fixture/0.6.19/jini.plugin.json': providerArtifact,
    '/packages/agent-plugins/charts-fixture/plugin.json': face,
  };
  // The face is read in place: its source folder holds tests the tarball never carries.
  const digests: Record<string, Record<string, string>> = {
    '/packages/provider-plugins/plugins/charts-fixture/0.6.19': { 'client/provider.js': digest },
    '/packages/agent-plugins/charts-fixture': { 'plugin.json': digest, '__tests__/manifest.test.mjs': digest, 'lib/__tests__/x.mjs': digest },
  };
  const ports = {
    readJson: async (file: string) => {
      if (!(file in files)) throw new Error(`ENOENT ${file}`);
      return files[file];
    },
    integrity: async ({ sourceDir }: { sourceDir: string }) => digests[sourceDir] ?? {},
  };
  const generate = () => generateCatalog({ packagesRoot: '/packages', providerIds: ['charts-fixture'],
    agentPlugins: [{ name: 'charts-fixture', sourceDir: 'packages/agent-plugins/charts-fixture' }], ports });
  return { files, digests, provider, providerArtifact, face, generate };
}

describe('agent subpaths, provider-plugins providers and browser-only providers', () => {
  it('lists a provider and its face that share a local id as two entries keyed by kind', async () => {
    const result = await combinedFixture().generate();
    expect(result).toEqual([
      { kind: 'agent', path: 'charts-fixture', pluginVersion: '0.1.0', contract: { id: 'agent-plugins', version: '1.0.0' },
        id: 'charts-fixture', publisherIdentity: 'jini/charts-fixture-agent', packageName: '@jini-ai/agent-plugins',
        version: '0.6.19', description: 'charts-fixture', expectedDigests: { 'plugin.json': digest } },
      { kind: 'provider', path: 'plugins/charts-fixture/0.6.19', pluginVersion: '0.6.19', contract: { id: 'browser-provider:chart', version: 1 },
        id: 'charts-fixture', publisherIdentity: 'jini/charts-fixture', packageName: '@jini-ai/provider-plugins',
        version: '0.6.19', description: 'Fixture charts', expectedDigests: { 'client/provider.js': digest } },
    ]);
  });

  it('refuses a face and a provider that claim the same publisher identity instead of merging them', async () => {
    const input = combinedFixture();
    input.face.extensions.tovu.id = 'jini/charts-fixture';
    await expect(input.generate()).rejects.toThrow('Catalog publisher identity clash: jini/charts-fixture');
  });

  it('refuses the same plugin listed twice in one kind', async () => {
    const input = fixture();
    await expect(generateCatalog({ packagesRoot: '/packages', providerIds: ['fixture-provider', 'fixture-provider'], agentPlugins: [],
      ports: input.ports })).rejects.toThrow('Duplicate catalog entry: provider:fixture-provider');
  });

  it('requires the declared browser bundle digest of a browser-only provider', async () => {
    const input = combinedFixture();
    input.digests['/packages/provider-plugins/plugins/charts-fixture/0.6.19'] = { 'client/other.js': digest };
    input.providerArtifact.integrity = { 'client/other.js': digest };
    await expect(input.generate()).rejects.toThrow('Missing provider entry digest: charts-fixture');
  });

  it('does not invent a contract for a provider with neither server nor browser contributions', () => {
    const { provider } = combinedFixture();
    const packageManifest = { name: '@jini-ai/provider-plugins', version: '0.6.19', description: '' };
    const optional = { packageName: '@jini-ai/provider-plugins' };
    expect(() => catalogEntry({ id: 'charts-fixture', packageManifest, pluginManifest: { ...provider, browserProviders: [] } }, optional))
      .toThrow('Missing provider contract');
    expect(() => catalogEntry({ id: 'charts-fixture', packageManifest,
      pluginManifest: { ...provider, contributes: { providers: [] } } }, optional)).toThrow('Missing provider contract');
  });

  it('an agent entry names the agent-plugins package and its subpath, never a per-plugin package', () => {
    const { face } = combinedFixture();
    const pluginManifest = { ...face, name: 'posthog', extensions: { tovu: { id: 'tovu/posthog' } } };
    const packageManifest = { name: AGENT_PLUGINS_PACKAGE, version: '0.6.19', description: '' };
    expect(catalogEntry({ id: 'posthog', packageManifest, pluginManifest }, { kind: 'agent', packageName: AGENT_PLUGINS_PACKAGE }))
      .toMatchObject({ kind: 'agent', path: 'posthog', packageName: AGENT_PLUGINS_PACKAGE, publisherIdentity: 'tovu/posthog' });
    expect(catalogEntry({ id: 'posthog', packageManifest, pluginManifest }, { kind: 'agent' }).packageName).toBe(AGENT_PLUGINS_PACKAGE);
  });

  it('always catalogues providers from their shared owner even if a retired wrapper exists', async () => {
    const input = combinedFixture();
    input.files['/packages/plugin-charts-fixture/package.json'] = { name: '@jini-ai/plugin-charts-fixture', version: '0.6.19', description: 'retired' };
    const result = await generateCatalog({ packagesRoot: '/packages', providerIds: ['charts-fixture'], agentPlugins: [], ports: {
      readJson: async file => input.files[file], integrity: async ({ sourceDir }) => input.digests[sourceDir] ?? {},
    } });
    expect(result.map(entry => [entry.kind, entry.packageName])).toEqual([['provider', '@jini-ai/provider-plugins']]);
  });
});

describe('release catalog generation', () => {
  it('records the integrity owner output and keeps the source unchanged', async () => {
    const input = fixture();
    const result = await generateCatalog({ packagesRoot: '/packages', providerIds: ['fixture-provider'], agentPlugins: [], ports: input.ports });
    expect(result[0]).toEqual({ ...catalogEntry({ id: 'fixture-provider', ...input }), expectedDigests: { 'server/index.mjs': digest } });
    expect(input.pluginManifest.version).toBe('0.6.12');
    expect(input.pluginManifest.integrity).toEqual({});
  });

  it('rejects a package claiming another plugin id', () => {
    const input = fixture();
    input.packageManifest.name = '@jini-ai/plugin-observability-sentry';
    expect(() => catalogEntry({ id: 'fixture-provider', ...input })).toThrow('identity disagree');
  });

  it('rejects an absent provider contract', () => {
    const input = fixture();
    input.pluginManifest.contributes.providers = [];
    expect(() => catalogEntry({ id: 'fixture-provider', ...input })).toThrow('Missing provider contract');
  });

  it('rejects missing completed payloads instead of publishing placeholders', async () => {
    const input = fixture();
    input.ports.integrity = async () => { throw new Error('ENOENT'); };
    await expect(generateCatalog({ packagesRoot: '/packages', providerIds: ['fixture-provider'], agentPlugins: [], ports: input.ports })).rejects.toThrow('ENOENT');
  });

  it('rejects stale artifact versions', async () => {
    const input = fixture();
    input.artifact.version = '0.6.13';
    await expect(generateCatalog({ packagesRoot: '/packages', providerIds: ['fixture-provider'], agentPlugins: [], ports: input.ports })).rejects.toThrow('Stale plugin metadata');
  });

  it('rejects modified payloads even with otherwise matching metadata', async () => {
    const input = fixture();
    input.artifact.integrity['server/index.mjs'] = `sha256-${'b'.repeat(64)}`;
    await expect(generateCatalog({ packagesRoot: '/packages', providerIds: ['fixture-provider'], agentPlugins: [], ports: input.ports })).rejects.toThrow('Plugin integrity mismatch');
  });

  it('rejects a provider payload with no entry digest', async () => {
    const input = fixture();
    await expect(generateCatalog({ packagesRoot: '/packages', providerIds: ['fixture-provider'], agentPlugins: [], ports: {
      readJson: async file => file.includes('/plugins/') ? { ...input.artifact, integrity: {} } : input.ports.readJson(file),
      integrity: async () => ({}),
    } })).rejects.toThrow('Missing provider entry digest');
  });

  it('records agent file digests without changing its manifest or schema version', async () => {
    const plugin = await readJson(path.join(packagesRoot, 'agent-plugins/ui-ux-design/plugin.json'));
    const pkg = agentPluginsPackage;
    const result = await generateCatalog({ packagesRoot: '/packages', providerIds: [], agentPlugins: [designRow], ports: {
      readJson: async file => file.endsWith('package.json') ? pkg : plugin,
      integrity: async () => ({ 'plugin.json': digest, 'skills/ui-ux-design/SKILL.md': digest, '__tests__/bundled-package.test.mjs': digest }),
    } });
    expect(result[0]).toMatchObject({ kind: 'agent', pluginVersion: (plugin as { version: string }).version, version: pkg.version, packageName: AGENT_PLUGINS_PACKAGE,
      contract: { id: 'agent-plugins', version: '1.0.0' },
      expectedDigests: { 'plugin.json': digest, 'skills/ui-ux-design/SKILL.md': digest } });
  });

  it('rejects an empty agent payload digest map', async () => {
    const plugin = await readJson(path.join(packagesRoot, 'agent-plugins/ui-ux-design/plugin.json'));
    const pkg = agentPluginsPackage;
    await expect(generateCatalog({ packagesRoot: '/packages', providerIds: [], agentPlugins: [designRow], ports: {
      readJson: async file => file.endsWith('package.json') ? pkg : plugin,
      integrity: async () => ({}),
    } })).rejects.toThrow('Missing plugin digests');
  });
});
