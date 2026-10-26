import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it, vi } from 'vitest';
import { loadProviderPluginArtifact } from '../../node/index.js';
import type { PluginManifest } from '../../manifest.js';
import { pluginSdkBinding, tierPolicy } from '../support/fixture-bindings.js';

const source = `export default { definition: { setup(sdk) {
  sdk.providers.register({ contract: 'fixture', id: 'fixture', contractVersion: 1,
    factory(input, options) {
      let disposed = false;
      return { port: { read: () => disposed ? undefined : input.value + options.suffix },
        dispose() { disposed = true; options.closed(); } };
    }
  });
} } };`;

/** Real artifact bytes and digest; no site workspace or activation row exists. */
async function fixture(_required: Record<string, never>, _options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'jini-provider-artifact-'));
  const entryPath = path.join(root, 'server', 'index.mjs');
  await mkdir(path.dirname(entryPath));
  await writeFile(entryPath, source);
  const manifest: PluginManifest = {
    id: 'fixture-provider', name: 'Fixture', version: '1.0.0', sdkRange: '^0.1.0', engine: 1, tier: 'tier-3',
    capabilities: ['providers.register'], hooks: [], fields: [],
    contributes: { providers: [{ contract: 'fixture', id: 'fixture', contractVersion: 1 }] },
    integrity: { 'server/index.mjs': `sha256-${createHash('sha256').update(source).digest('hex')}` },
  };
  await writeFile(path.join(root, 'jini.plugin.json'), JSON.stringify(manifest));
  const imported = vi.fn(async ({ modulePath }: { modulePath: string }) => ({ exported: (await import(pathToFileURL(modulePath).href)).default }));
  return { root, imported, required: {
    load: { record: { id: manifest.id, name: manifest.name, version: manifest.version, source: 'built-in' as const, status: 'valid' as const, errors: [] },
      manifest, entryPath, pluginSdkBinding, tierPolicy,
      coreDeps: { getCurrentEntry: () => { throw new Error('no site context'); }, writeExtField: () => { throw new Error('no site writes'); }, attachFilter: () => { throw new Error('no site hooks'); } },
      verifyDigest: async ({ absoluteFilePath }: { absoluteFilePath: string }) => `sha256-${createHash('sha256').update(await readFile(absoluteFilePath)).digest('hex')}`,
      importModule: imported },
    contracts: [{ contract: 'fixture', validate: ({ provider }: { provider: unknown }) => typeof (provider as { read?: unknown })?.read === 'function' ? undefined : 'expected read port' }],
    contract: 'fixture', id: 'fixture', input: { value: 'fixture' },
  } };
}

it('loads and initializes a provider outside any site and disposes it once at shutdown', async () => {
  const { root, required, imported } = await fixture({});
  const closed = vi.fn();
  try {
    const resource = await loadProviderPluginArtifact(required, { factoryOptions: { suffix: '-output', closed } });
    const port = resource.port as { read(): string | undefined };
    try {
      expect(port.read()).toBe('fixture-output');
      expect(imported).toHaveBeenCalledTimes(1);
    } finally { await resource.dispose({}); }
    await resource.dispose({});
    expect(port.read()).toBeUndefined();
    expect(closed).toHaveBeenCalledTimes(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('refuses tampered bytes before evaluating any provider code', async () => {
  const { root, required, imported } = await fixture({});
  try {
    await writeFile(required.load.entryPath, source + '\n// tampered');
    await expect(loadProviderPluginArtifact(required)).rejects.toThrow('provider artifact load failed: INTEGRITY_FAILED');
    expect(imported).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('releases a factory result rejected by the domain validator', async () => {
  const { root, required } = await fixture({});
  const closed = vi.fn();
  try {
    await expect(loadProviderPluginArtifact({ ...required, contracts: [{ contract: 'fixture', validate: () => 'fixture refusal' }] }, {
      factoryOptions: { suffix: '-output', closed },
    })).rejects.toThrow("fixture provider 'fixture' is invalid: fixture refusal");
    expect(closed).toHaveBeenCalledTimes(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
