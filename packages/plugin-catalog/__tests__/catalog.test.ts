/** Catalog metadata must correspond to real standalone packages without shipping their bytes. */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { catalogEntry, generateCatalog, type CatalogEntry } from '../scripts/generate.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const packagesRoot = path.dirname(root);
const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const entries = await readJson(path.join(root, 'catalog.json')) as CatalogEntry[];
const designPackage = await readJson(path.join(packagesRoot, 'plugin-ui-ux-design/package.json'));
const digest = `sha256-${'a'.repeat(64)}`;

describe('standalone plugin catalog', () => {
  it('lists every provider source exactly once and the shared design agent', async () => {
    const sources = await readdir(path.join(packagesRoot, 'provider-plugins/src'), { withFileTypes: true });
    const ids = sources.filter(item => item.isDirectory() && !item.name.startsWith('__')).map(item => item.name);
    expect(entries.map(entry => entry.id)).toEqual([...ids, 'ui-ux-design'].sort());
  });

  it.each(entries)('$id matches its real package, publisher, path and contract', async entry => {
    const packageManifest = await readJson(path.join(packagesRoot, `plugin-${entry.id}/package.json`));
    const source = entry.kind === 'agent' ? `agent-plugins/${entry.id}/plugin.json`
      : `provider-plugins/src/${entry.id}/jini.plugin.json`;
    const pluginManifest = await readJson(path.join(packagesRoot, source));
    expect(entry).toEqual({ ...catalogEntry({ id: entry.id, packageManifest, pluginManifest }), expectedDigests: entry.expectedDigests });
    expect(entry.publisherIdentity).toBe(`jini/${entry.id}`);
    if (entry.kind === 'provider') expect(packageManifest.version).toBe('0.7.0');
    expect(entry.path.startsWith('/')).toBe(false);
    expect(entry.path.split('/')).not.toContain('..');
  });

  it('preserves the agent manifest version independently of the npm release', () => {
    expect(entries.find(entry => entry.kind === 'agent')).toMatchObject({
      version: designPackage.version, pluginVersion: '0.4.6', contract: { id: 'agent-plugins', version: '1.0.0' },
    });
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
  const packageManifest = { name: '@jini-ai/plugin-fixture-provider', version: '0.7.0', description: 'Fixture' };
  const artifact = { ...pluginManifest, version: '0.7.0', integrity: { 'server/index.mjs': digest } };
  const ports = {
    readJson: async (file: string) => {
      if (file.endsWith('package.json')) return packageManifest;
      return file.includes('/src/') ? pluginManifest : artifact;
    },
    integrity: async () => ({ 'server/index.mjs': digest }),
  };
  return { pluginManifest, packageManifest, artifact, ports };
}

describe('release catalog generation', () => {
  it('records the integrity owner output and keeps the source unchanged', async () => {
    const input = fixture();
    const result = await generateCatalog({ packagesRoot: '/packages', ids: ['fixture-provider'], ports: input.ports });
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
    await expect(generateCatalog({ packagesRoot: '/packages', ids: ['fixture-provider'], ports: input.ports })).rejects.toThrow('ENOENT');
  });

  it('rejects stale artifact versions', async () => {
    const input = fixture();
    input.artifact.version = '0.6.13';
    await expect(generateCatalog({ packagesRoot: '/packages', ids: ['fixture-provider'], ports: input.ports })).rejects.toThrow('Stale plugin metadata');
  });

  it('rejects modified payloads even with otherwise matching metadata', async () => {
    const input = fixture();
    input.artifact.integrity['server/index.mjs'] = `sha256-${'b'.repeat(64)}`;
    await expect(generateCatalog({ packagesRoot: '/packages', ids: ['fixture-provider'], ports: input.ports })).rejects.toThrow('Plugin integrity mismatch');
  });

  it('rejects a provider payload with no entry digest', async () => {
    const input = fixture();
    await expect(generateCatalog({ packagesRoot: '/packages', ids: ['fixture-provider'], ports: {
      readJson: async file => file.includes('/plugins/') ? { ...input.artifact, integrity: {} } : input.ports.readJson(file),
      integrity: async () => ({}),
    } })).rejects.toThrow('Missing provider entry digest');
  });

  it('records agent file digests without changing its manifest or schema version', async () => {
    const plugin = await readJson(path.join(packagesRoot, 'agent-plugins/ui-ux-design/plugin.json'));
    const pkg = await readJson(path.join(packagesRoot, 'plugin-ui-ux-design/package.json'));
    const result = await generateCatalog({ packagesRoot: '/packages', ids: ['ui-ux-design'], ports: {
      readJson: async file => file.endsWith('package.json') ? pkg : plugin,
      integrity: async () => ({ 'plugin.json': digest, 'skills/ui-ux-design/SKILL.md': digest }),
    } });
    expect(result[0]).toMatchObject({ kind: 'agent', pluginVersion: '0.4.6', version: pkg.version,
      contract: { id: 'agent-plugins', version: '1.0.0' },
      expectedDigests: { 'plugin.json': digest, 'skills/ui-ux-design/SKILL.md': digest } });
  });

  it('rejects an empty agent payload digest map', async () => {
    const plugin = await readJson(path.join(packagesRoot, 'agent-plugins/ui-ux-design/plugin.json'));
    const pkg = await readJson(path.join(packagesRoot, 'plugin-ui-ux-design/package.json'));
    await expect(generateCatalog({ packagesRoot: '/packages', ids: ['ui-ux-design'], ports: {
      readJson: async file => file.endsWith('package.json') ? pkg : plugin,
      integrity: async () => ({}),
    } })).rejects.toThrow('Missing plugin digests');
  });
});
