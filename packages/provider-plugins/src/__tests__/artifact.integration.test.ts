import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { paymentsProviderContract, type PaymentProvider, type ProviderContext } from '@jini-ai/commerce/payments/kernel';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readdir, readFile, rm, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  createPluginContributionRegistry, createPluginProviderHost, type ManifestHostPorts, type PluginSdkBinding,
  type PluginManifest, type PluginTierPolicy,
} from '@jini-ai/plugins/host';
import { buildProviderPlugin } from '../../scripts/build.js';
import { assertPluginPackageIsolation } from '../../../../scripts/check-plugin-isolation.js';
import { ADAPTER_FILE, POSTHOG_BROWSER_VERSION, POSTHOG_SDK_INTEGRITY, SDK_FILE } from '../analytics-posthog/consent.js';
import type { createPostHogProvider } from '../analytics-posthog/index.js';
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
  'ai-trace-langfuse': { contract: 'ai_trace', id: 'langfuse', validate: port => typeof (port as { record?: unknown })?.record === 'function',
    input: () => ({ publicKey: 'pk-lf-unused', secretKey: 'sk-lf-unused', baseUrl: 'http://langfuse.invalid' }) },
  'analytics-posthog': { contract: 'product_analytics', id: 'posthog', validate: port => typeof (port as { capture?: unknown })?.capture === 'function',
    input: () => ({ apiKey: 'phc_unused', host: 'https://posthog.invalid' }) },
  'fixture-provider': { contract: 'fixture', id: 'fixture', validate: port => typeof (port as { read?: unknown })?.read === 'function', input: namespace => ({ value: namespace }),
    probe: port => (port as { read(required: Record<string, never>): unknown }).read({}) },
  'payments-stripe': { contract: 'payments', id: 'stripe', validate: port => paymentsProviderContract.validate({ provider: port }) === undefined,
    input: () => ({}) },
  'observability-opentelemetry': { contract: 'observability', id: 'opentelemetry', validate: port => typeof (port as { trackRequest?: unknown })?.trackRequest === 'function',
    input: () => ({ serviceName: 'artifact-test', tracerName: 'artifact', endpoint: 'http://127.0.0.1:9', headers: { authorization: 'Bearer unused' } }) },
  'observability-sentry': { contract: 'observability', id: 'sentry', validate: port => typeof (port as { reportError?: unknown })?.reportError === 'function',
    input: () => ({ dsn: 'https://public@sentry.invalid/1' }) },
};

let root: string;
const artifacts = new Map<string, { artifact: string; installedPackage: string; packedPaths: string[] }>();
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'provider-artifact-'));
  for (const id of Object.keys(SPECS).sort()) {
    const destinationPackageRoot = path.join(packageRoot, '..', `plugin-${id}`);
    const outputRoot = path.join(root, id, 'distribution');
    const entry = await buildProviderPlugin({ packageRoot, id, destinationPackageRoot }, { outputRoot });
    // Pack the exact publish file list, then install from extracted bytes. Build already ran above;
    // ignoring lifecycle here prevents npm from rerunning the build against this isolated staging dir.
    for (const filename of ['package.json', 'README.md', 'LICENSE', 'NOTICE']) await copyFile(path.join(destinationPackageRoot, filename), path.join(outputRoot, filename));
    const packed = await exec('npm', ['pack', '--offline', '--ignore-scripts', '--json', '--cache', path.join(root, 'npm-cache')], { cwd: outputRoot });
    const [packedFile] = JSON.parse(packed.stdout) as Array<{ filename: string; files: { path: string }[] }>;
    const hostRoot = path.join(root, id, 'host');
    const installedPackage = path.join(hostRoot, 'node_modules/@jini-ai', `plugin-${id}`);
    await mkdir(installedPackage, { recursive: true });
    await exec('tar', ['-xzf', path.join(outputRoot, packedFile!.filename), '-C', installedPackage, '--strip-components', '1']);
    const resolve = createRequire(path.join(hostRoot, 'host.cjs')).resolve;
    expect(resolve(`@jini-ai/plugin-${id}/package.json`)).toBe(path.join(installedPackage, 'package.json'));
    artifacts.set(id, { artifact: path.join(installedPackage, entry.path), installedPackage, packedPaths: packedFile!.files.map(file => file.path) });
  }
}, 120_000);
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

it('packs every provider source in its own package, each with a spec here', async () => {
  const sources = (await readdir(path.join(packageRoot, 'src'), { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('__')).map(entry => entry.name).sort();
  expect([...artifacts.keys()]).toEqual(sources);
  expect([...artifacts.keys()]).toEqual(Object.keys(SPECS).sort());
});

it('packs the provider NOTICE and integrity-pins its retained copy in the Stripe artifact', async () => {
  const { artifact, installedPackage } = artifacts.get('payments-stripe')!;
  const manifest = JSON.parse(await readFile(path.join(artifact, 'jini.plugin.json'), 'utf8')) as PluginManifest;
  // retainLicenses sanitizes the package name, including its leading @, to underscores.
  const noticePath = 'licenses/_jini-ai_plugin-payments-stripe/NOTICE';
  const notice = await readFile(path.join(artifact, noticePath), 'utf8');
  expect(manifest.integrity[noticePath]).toBe(`sha256-${createHash('sha256').update(notice).digest('hex')}`);
  expect(notice).toContain('Open SaaS');
  expect(notice).toContain('c2c6285bdb14b040584505372ad9bb062a0bca11');
  expect(notice).toContain('Copyright (c) 2023 wasp-lang');
  expect(notice).toContain('Permission is hereby granted, free of charge');
  expect(notice).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  expect(await readFile(path.join(installedPackage, 'NOTICE'), 'utf8')).toBe(notice);
});

it.each(Object.keys(SPECS))('%s: packs, installs and loads identical standalone bytes with both host SDK ABIs outside the workspace', async (pluginId) => {
  const spec = SPECS[pluginId]!;
  const { artifact, installedPackage, packedPaths } = artifacts.get(pluginId)!;
  const packageManifest = JSON.parse(await readFile(path.join(installedPackage, 'package.json'), 'utf8'));
  expect(packageManifest.name).toBe(`@jini-ai/plugin-${pluginId}`);
  expect(() => assertPluginPackageIsolation({ manifest: packageManifest, packedPaths, pluginIds: [...Object.keys(SPECS), 'ui-ux-design'] })).not.toThrow();
  expect(packedPaths).toEqual(expect.arrayContaining(['package.json', 'README.md', 'LICENSE', 'NOTICE']));
  expect(await readdir(path.join(installedPackage, 'plugins'))).toEqual([pluginId]);
  expect(await readdir(path.dirname(installedPackage))).toEqual([`plugin-${pluginId}`]);
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) expect(Object.keys(packageManifest[field] ?? {})).toEqual([]);
  const manifest = JSON.parse(await readFile(path.join(artifact, 'jini.plugin.json'), 'utf8')) as PluginManifest;
  expect(manifest).toMatchObject({ id: pluginId, tier: 'tier-3', engine: 1, sdkRange: '^0.1.0 || ^1.0.0', capabilities: ['providers.register'],
    contributes: { providers: [{ contract: spec.contract, id: spec.id, contractVersion: 1 }] }, hooks: [], fields: [] });
  expect(manifest.version).toBe(packageManifest.version);
  expect(manifest.integrity['server/index.mjs']).toMatch(/^sha256-[a-f0-9]{64}$/);
  expect(Object.keys(manifest.integrity).some(key => key.startsWith('licenses/'))).toBe(true);
  for (const [file, digest] of Object.entries(manifest.integrity)) {
    expect(`sha256-${createHash('sha256').update(await readFile(path.join(artifact, file))).digest('hex')}`).toBe(digest);
  }
  // A new Node process, rooted outside the repo with no NODE_PATH (so no vendor SDK is resolvable),
  // can import the actual bytes, register, initialize and dispose.
  const standalone = await exec(process.execPath, ['--input-type=module', '-e', `
    import { createRequire } from 'node:module';
    import { readdirSync } from 'node:fs';
    const resolve = createRequire(${JSON.stringify(pathToFileURL(path.join(installedPackage, 'package.json')).href)}).resolve;
    if (readdirSync(${JSON.stringify(path.dirname(installedPackage))}).join() !== ${JSON.stringify(`plugin-${pluginId}`)}) throw new Error('sibling plugin available');
    for (const name of ['posthog-node', 'posthog-js', '@sentry/node', 'langfuse', '@opentelemetry/api', '@opentelemetry/sdk-trace-node']) {
      let available = false;
      try { resolve(name); available = true; } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
      if (available) throw new Error('vendor SDK available: ' + name);
    }
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
    if (pluginId === 'payments-stripe') {
      const port = lease.port as PaymentProvider;
      const send = vi.fn<ProviderContext['httpClient']['send']>();
      const ctx: ProviderContext = { credentials: { webhookSecret: 'whsec_unused' }, account: { providerAccountId: 'acct_1', mode: 'test' },
        httpClient: { send }, now: () => 0, returnUrl: 'https://shop.test/return', cancelUrl: 'https://shop.test/cancel', webhookUrl: 'https://shop.test/hook' };
      expect(await port.verifyWebhook({ rawBody: new TextEncoder().encode('garbage'), headers: {}, ctx }))
        .toMatchObject({ kind: 'rejected', error: { code: 'SIGNATURE_INVALID', retryable: false } });
      expect(send).not.toHaveBeenCalled();
      expect(['charge', 'getCharge', 'refund'].filter(method => method in port)).toEqual([]);
    }
    if (pluginId === 'analytics-posthog') {
      const port = lease.port as ReturnType<typeof createPostHogProvider>['port'];
      const { adapter, http } = port.consentAdapter({ path: '/_consent/posthog' });
      expect(adapter).toMatchObject({ kind: 'consent-adapter', category: 'analytics', supportsAnonymous: true,
        src: `/_consent/posthog/${ADAPTER_FILE}`, config: { integrity: POSTHOG_SDK_INTEGRITY, sessionReplay: false } });
      const sdk = await http.handle({ method: 'GET', path: `/sdk-${POSTHOG_BROWSER_VERSION}.js`, body: new Uint8Array(), contentType: '' });
      expect(sdk.status).toBe(200);
      expect(sdk.body).toBe(await readFile(path.join(artifact, 'server', SDK_FILE), 'utf8'));
      expect(`sha256-${createHash('sha256').update(sdk.body).digest('base64')}`).toBe(POSTHOG_SDK_INTEGRITY);
      expect(await http.handle({ method: 'POST', path: '/e/', body: new Uint8Array(), contentType: 'application/json' }))
        .toEqual({ status: 403, body: '' });
      const browserAdapter = await http.handle({ method: 'GET', path: `/${ADAPTER_FILE}`, body: new Uint8Array(), contentType: '' });
      expect(browserAdapter.status).toBe(200);
      expect(browserAdapter.body).toBe(await readFile(path.join(artifact, 'server', ADAPTER_FILE), 'utf8'));
    }
    if (spec.probe) expect(spec.probe(lease.port)).toBe(namespace);
    await providerHost.dispose({});
    if (spec.probe) expect(spec.probe(lease.port)).toBeUndefined();
  }
}, 60_000);
