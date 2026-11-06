import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { computePluginIntegrity } from '@jini-ai/plugins/host/node';
import { catalogEntry, type CatalogEntry } from '../../packages/plugin-catalog/scripts/generate.js';
import { checkPluginReleaseConsistency } from '../check-plugin-packages.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'jini-release-consistency-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function write(file: string, content: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
}

async function provider(packageRoot: string, bytes = 'export const value = 1;'): Promise<CatalogEntry> {
  const pkg = { name: '@jini-ai/provider-plugins', version: '1.0.0', description: 'providers' };
  const plugin = { id: 'fixture', name: 'Fixture', version: '1.0.0', extensions: { tovu: { id: 'jini/fixture' } },
    contributes: { providers: [{ contract: 'fixture', contractVersion: 1 }] } };
  const artifact = join(packageRoot, 'plugins/fixture/1.0.0');
  write(join(packageRoot, 'package.json'), pkg);
  write(join(artifact, 'server/index.mjs'), bytes);
  const integrity = await computePluginIntegrity({ sourceDir: artifact });
  write(join(artifact, 'jini.plugin.json'), { ...plugin, integrity });
  return { ...catalogEntry({ id: 'fixture', packageManifest: pkg, pluginManifest: plugin }), expectedDigests: integrity };
}

async function agent(packageRoot: string, version = '0.3.1', bytes = 'original'): Promise<CatalogEntry> {
  const pkg = { name: '@jini-ai/agent-plugins', version: '1.0.0', description: 'agents' };
  const plugin = { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'face', version,
    extensions: { tovu: { id: 'jini/face' } } };
  write(join(packageRoot, 'package.json'), pkg);
  write(join(packageRoot, 'face/plugin.json'), plugin);
  write(join(packageRoot, 'face/skill.md'), bytes);
  return { ...catalogEntry({ id: 'face', packageManifest: pkg, pluginManifest: plugin }),
    expectedDigests: await computePluginIntegrity({ sourceDir: join(packageRoot, 'face') }) };
}

it('rejects locally sealed provider bytes when the skipped npm version contains different bytes', async () => {
  const entry = await provider(join(root, 'packages/provider-plugins'));
  await provider(join(root, 'published'), 'export const value = 2;');
  await expect(checkPluginReleaseConsistency({ entries: [entry], pendingPackages: new Map() }, {
    publishedPackage: async () => join(root, 'published'),
  })).rejects.toThrow('Release catalog mismatch: provider:fixture');
});

it('accepts selected pending provider bytes and never looks them up as a skipped version', async () => {
  const entry = await provider(join(root, 'packages/provider-plugins'));
  const publishedPackage = vi.fn(async () => { throw new Error('must use selected release bytes'); });
  await expect(checkPluginReleaseConsistency({ entries: [entry],
    pendingPackages: new Map([['@jini-ai/provider-plugins@1.0.0', join(root, 'packages/provider-plugins')]]) }, { publishedPackage })).resolves.toBeUndefined();
  expect(publishedPackage).not.toHaveBeenCalled();
});

it('refuses a missing package version in a filtered release and propagates registry failures', async () => {
  const entry = await provider(join(root, 'packages/provider-plugins'));
  const required = { entries: [entry], pendingPackages: new Map() };
  await expect(checkPluginReleaseConsistency(required, { publishedPackage: async () => undefined }))
    .rejects.toThrow('not published or selected');
  await expect(checkPluginReleaseConsistency(required, { publishedPackage: async () => { throw new Error('registry unavailable'); } }))
    .rejects.toThrow('registry unavailable');
});

it('rejects provider manifest version drift even if its metadata and file hashes otherwise agree', async () => {
  const entry = await provider(join(root, 'published'));
  const file = join(root, 'published/plugins/fixture/1.0.0/jini.plugin.json');
  write(file, { ...JSON.parse(readFileSync(file, 'utf8')), version: '0.9.0' });
  await expect(checkPluginReleaseConsistency({ entries: [entry], pendingPackages: new Map() }, {
    publishedPackage: async () => join(root, 'published'),
  })).rejects.toThrow('Release catalog mismatch: provider:fixture');
});

it('requires changed agent bytes to advance their own version, while unchanged versions remain valid', async () => {
  const packageRoot = join(root, 'packages/agent-plugins');
  await agent(join(root, 'published'));
  const publishedPackage = async () => join(root, 'published');
  const required = { pendingPackages: new Map([['@jini-ai/agent-plugins@1.0.0', join(root, 'packages/agent-plugins')]]) };
  const unchanged = await agent(packageRoot);
  await expect(checkPluginReleaseConsistency({ ...required, entries: [unchanged] }, { publishedPackage })).resolves.toBeUndefined();
  const changed = await agent(packageRoot, '0.3.1', 'updated');
  await expect(checkPluginReleaseConsistency({ ...required, entries: [changed] }, { publishedPackage }))
    .rejects.toThrow('Agent plugin face changed without advancing 0.3.1');
  const bumped = await agent(packageRoot, '0.3.2', 'updated');
  await expect(checkPluginReleaseConsistency({ ...required, entries: [bumped] }, { publishedPackage })).resolves.toBeUndefined();
});

it('checks every catalog record and permits an agent newly added to the published distribution', async () => {
  const providerEntry = await provider(join(root, 'published'));
  const agentEntry = await agent(join(root, 'packages/agent-plugins'));
  await expect(checkPluginReleaseConsistency({ entries: [providerEntry, agentEntry],
    pendingPackages: new Map([['@jini-ai/agent-plugins@1.0.0', join(root, 'packages/agent-plugins')]]) }, {
    publishedPackage: async () => join(root, 'published'),
  })).resolves.toBeUndefined();
  await provider(join(root, 'published'), 'changed');
  await expect(checkPluginReleaseConsistency({ entries: [agentEntry, providerEntry],
    pendingPackages: new Map([['@jini-ai/agent-plugins@1.0.0', join(root, 'packages/agent-plugins')]]) }, {
    publishedPackage: async () => join(root, 'published'),
  })).rejects.toThrow('Release catalog mismatch: provider:fixture');
});

it('rejects a catalog pointing at an old registry version when the distribution release selects a newer version', async () => {
  const entry = await provider(join(root, 'published'));
  await expect(checkPluginReleaseConsistency({ entries: [entry],
    pendingPackages: new Map([['@jini-ai/provider-plugins@1.0.1', join(root, 'pending')]]) }, {
    publishedPackage: async () => join(root, 'published'),
  })).rejects.toThrow('Release catalog version mismatch');
});

it('imports the release preparation path in Node without running a release', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-'], {
    cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 30_000,
    input: "import { preparePluginRelease } from './scripts/publish-pending.ts'; console.log(typeof preparePluginRelease);",
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe('function');
});
