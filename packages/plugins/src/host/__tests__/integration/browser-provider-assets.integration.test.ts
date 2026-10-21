/** ADR-025 approved bundled-chart exception: admission is host-owned, retained bytes are served. */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPlugin } from '../support/loader.js';
import { admitBrowserProviderAssets } from '../../node/index.js';
import { createInvocationCoreDeps } from '../support/fixture-bindings.js';
import type { PluginManifest } from '../../manifest.js';
import type { BundledBrowserProviderApproval } from '../../ports.js';

const digest = (value: string) => `sha256-${createHash('sha256').update(value).digest('hex')}`;
async function fixture(run: (input: { root: string; manifest: PluginManifest; approval: BundledBrowserProviderApproval }) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'jini-browser-provider-'));
  const files = { 'server/index.mjs': 'export default {};', 'client/provider.js': 'export function mount() {}', 'client/styles.css': '.chart { color: red; }' };
  for (const [file, bytes] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), bytes); }
  const manifest: PluginManifest = { id: 'charts-recharts', name: 'Charts', version: '0.1.0', sdkRange: '^0.1.0', engine: 1, tier: 'tier-3', capabilities: [], hooks: [], fields: [],
    integrity: Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file, digest(bytes)])),
    browserProviders: [{ id: 'plugin.recharts', kind: 'chart', contractVersion: 1, kinds: ['bar', 'line', 'pie'], javascript: 'client/provider.js', stylesheet: 'client/styles.css' }],
  };
  const approval: BundledBrowserProviderApproval = { pluginId: manifest.id, version: manifest.version, browserProviders: manifest.browserProviders!, integrity: { ...manifest.integrity } };
  try { await run({ root, manifest, approval }); } finally { await rm(root, { recursive: true, force: true }); }
}
function required(root: string, manifest: PluginManifest, approvals: readonly BundledBrowserProviderApproval[], source: 'site' | 'built-in' = 'built-in') {
  return { record: { id: manifest.id, name: manifest.name, version: manifest.version, source, status: 'valid' as const, errors: [] }, manifest, entryPath: path.join(root, 'server/index.mjs'),
    browserProviderApprovals: approvals, coreDeps: createInvocationCoreDeps({ pluginId: manifest.id, declaredHooks: [] }).coreDeps };
}

describe('bundled browser-provider asset admission', () => {
  it('retains verified bytes across disk changes and returns defensive copies', async () => fixture(async ({ root, manifest, approval }) => {
    const result = await loadPlugin(required(root, manifest, [approval]), { importModule: async () => ({ default: { definition: { setup() {} } } }) });
    expect(result.loaded).toBe(true);
    if (!result.loaded) throw new Error(result.reason);
    const asset = result.browserProviders![0]!.assets.find(({ path }) => path === 'client/provider.js')!;
    expect(new TextDecoder().decode(asset.readBytes({}))).toBe('export function mount() {}');
    await writeFile(path.join(root, 'client/provider.js'), 'tampered');
    const copy = asset.readBytes({}); copy.fill(0);
    expect(new TextDecoder().decode(asset.readBytes({}))).toBe('export function mount() {}');
    expect(asset.digest).toBe(approval.integrity['client/provider.js']);
  }));

  it('rejects installed and unreviewed providers without evaluating setup', async () => fixture(async ({ root, manifest, approval }) => {
    let imports = 0;
    for (const input of [required(root, manifest, [approval], 'site'), required(root, manifest, [])]) {
      expect(await loadPlugin(input, { importModule: async () => { imports++; return {}; } })).toEqual({ loaded: false, reason: 'BROWSER_PROVIDER_FORBIDDEN' });
    }
    expect(imports).toBe(0);
  }));

  it('rejects tampering even when the manifest is rewritten to match it', async () => fixture(async ({ root, manifest, approval }) => {
    await writeFile(path.join(root, 'client/provider.js'), 'tampered');
    for (const candidate of [manifest, { ...manifest, integrity: { ...manifest.integrity, 'client/provider.js': digest('tampered') } }]) {
      expect(await loadPlugin(required(root, candidate, [approval]), { importModule: async () => { throw new Error('must not import'); } }))
        .toEqual({ loaded: false, reason: 'INTEGRITY_FAILED' });
    }
  }));

  it('rejects path escape and ABI widening despite a host approval', async () => fixture(async ({ root, manifest, approval }) => {
    for (const declaration of [{ ...manifest.browserProviders![0]!, javascript: '../outside.js' }, { ...manifest.browserProviders![0]!, contractVersion: 2 }]) {
      const candidate = { ...manifest, browserProviders: [declaration] as never };
      expect(await loadPlugin(required(root, candidate, [{ ...approval, browserProviders: candidate.browserProviders! }]), { importModule: async () => ({}) }))
        .toEqual({ loaded: false, reason: 'BROWSER_PROVIDER_INVALID' });
    }
  }));

  it('does not expose assets when SDK compatibility or setup fails', async () => fixture(async ({ root, manifest, approval }) => {
    expect(await loadPlugin(required(root, manifest, [approval]), { runtimeSdkVersion: '9.0.0' }))
      .toEqual({ loaded: false, reason: 'SDK_RANGE_UNSATISFIED' });
    expect(await loadPlugin(required(root, manifest, [approval]), { importModule: async () => ({ default: { definition: { setup() { throw new Error('failed'); } } } }) }))
      .toEqual({ loaded: false, reason: 'PLUGIN_SETUP_FAILED' });
  }));

  it('admits a reviewed built-in that declares no browser providers with an empty provider list', async () => fixture(async ({ root, manifest, approval }) => {
    const { browserProviders: _providers, ...bare } = manifest;
    const record = { id: manifest.id, name: manifest.name, version: manifest.version, source: 'built-in' as const, status: 'valid' as const, errors: [] };
    expect(await admitBrowserProviderAssets({ record, manifest: bare, pluginRoot: root, approvals: [{ ...approval, browserProviders: [] }] }))
      .toEqual({ admitted: true, providers: [] });
  }));

  it('serves only the script when a provider declares no stylesheet', async () => fixture(async ({ root, manifest, approval }) => {
    const { stylesheet: _css, ...scriptOnly } = manifest.browserProviders![0]!;
    const candidate = { ...manifest, browserProviders: [scriptOnly] };
    const record = { id: manifest.id, name: manifest.name, version: manifest.version, source: 'built-in' as const, status: 'valid' as const, errors: [] };
    const result = await admitBrowserProviderAssets({ record, manifest: candidate, pluginRoot: root, approvals: [{ ...approval, browserProviders: [scriptOnly] }] });
    if (!result.admitted) throw new Error(result.reason);
    expect(result.providers[0]!.assets.map(({ path, contentType }) => [path, contentType])).toEqual([['client/provider.js', 'text/javascript']]);
  }));

  it('refuses with INTEGRITY_FAILED when the bytes on disk change after the loader verified them', async () => fixture(async ({ root, manifest, approval }) => {
    // The loader verifies before admission; a swap between the two reads must still be caught here.
    await writeFile(path.join(root, 'client/styles.css'), '.chart { color: blue; }');
    const record = { id: manifest.id, name: manifest.name, version: manifest.version, source: 'built-in' as const, status: 'valid' as const, errors: [] };
    expect(await admitBrowserProviderAssets({ record, manifest, pluginRoot: root, approvals: [approval] }))
      .toEqual({ admitted: false, reason: 'INTEGRITY_FAILED' });
  }));
});
