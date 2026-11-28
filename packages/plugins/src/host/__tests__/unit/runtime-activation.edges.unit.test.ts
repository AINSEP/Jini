/** Enable-path edges of the runtime activation phase that need a real install directory, real package
 * bytes or a host content-type store: an installed record with no manifest, declared content types
 * created around the plugin's code, a disable that lands while setup is still running, and reviewed
 * browser-provider assets published (and retired) with the plugin. */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPluginInvocationBinding, createPluginRuntimeCore, type PluginRuntimeCoreOptional, type PluginRuntimeHostBinding, type PluginRuntimeSource } from '../../node/index.js';
import { PluginLoadError } from '../../node/loader.js';
import type { PluginManifest } from '../../manifest.js';
import type { BundledBrowserProviderApproval, DeclarativeContentTypesPort, DeclaredContentTypePorts, PluginSdkBinding } from '../../ports.js';
import { InMemoryPluginActivationRepo } from '../../repo.memory.js';
import { manifestHost, pluginSdkBinding as baseBinding } from '../support/fixture-bindings.js';

const HOOK = 'record.preCommit';
const WS = 'ws-edges';
const sdkBinding: PluginSdkBinding = { ...baseBinding, hookIds: [HOOK], beforeSaveHook: HOOK, hookSemantics: { [HOOK]: 'shared' } };
const digest = (bytes: string) => `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
const manifestOf = (id: string, extra: Partial<PluginManifest> = {}): PluginManifest => ({
  id, name: id, version: '1.0.0', sdkRange: '>=0.0.0', engine: 1, tier: 'tier-3', capabilities: ['content.read'], hooks: [], fields: [], integrity: {}, ...extra,
});

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir, `${dir}-runtime`, `${dir}-trash`);
  return dir;
}

type Setup = (sdk: Record<string, unknown>) => unknown;
function host({ sources = [], enabled, runtime = {}, contentTypes = manifestHost.declarativeContentTypes }: {
  sources?: Array<{ manifest: PluginManifest; setup: Setup; entryPath?: string }>;
  enabled: readonly string[];
  runtime?: PluginRuntimeCoreOptional;
  contentTypes?: DeclarativeContentTypesPort;
}) {
  const imports: string[] = [];
  const hostBinding: PluginRuntimeHostBinding = {
    capabilityVocabulary: ['content.read', 'content.extend', 'hooks.attach'], declarativeContentTypes: contentTypes,
    coreOwnerName: 'Edge core', identityNamespace: 'edge', localInstallDisabledMessage: 'off',
    tierPolicy: { execution: 'in-process', allowLoad: () => true, siteErrors: () => [], checkInstall: () => {} },
    archiveReader: async () => { throw new Error('no archives'); },
    verifyDigest: async ({ absoluteFilePath }: { absoluteFilePath: string }) => digest(await readFile(absoluteFilePath, 'utf8')),
    createInvocationCoreDeps: ({ pluginId, declaredHooks }) => createPluginInvocationBinding({ pluginId, declaredHooks, beforeSaveHook: HOOK }, {}),
    fileLock: { withFileLock: async ({ run }: { run: () => unknown }) => run() } as never,
  };
  const runtimeSources: PluginRuntimeSource[] = sources.map(({ manifest, setup, entryPath }) => ({
    source: 'built-in' as const, manifest, entryPath: entryPath ?? `edge:${manifest.id}`,
    importModule: async () => ({ default: { definition: { setup } } }),
  }));
  const repo = new InMemoryPluginActivationRepo({ initialRows: enabled.map((pluginId) => (
    { pluginId, workspaceId: WS as never, version: '1.0.0', enabled: true, updatedAt: '2026-11-28T00:00:00.000Z' })) });
  const core = createPluginRuntimeCore({
    workspaceId: WS, clock: { nowMs: () => 0 } as never, activationRepo: repo, sources: runtimeSources,
    pluginSourcePolicy: { localInstallEnabled: () => false, confirmEnable: () => false },
    tier2CallRunner: (async () => { throw new Error('no tier-2 here'); }) as never, pluginSdkBinding: sdkBinding, hostBinding,
    createModuleImporter: ((_required: unknown, optional: { importModule?: (entryPath: string) => Promise<{ default: unknown }> } = {}) =>
      async ({ modulePath }: { modulePath: string }) => {
        imports.push(modulePath);
        if (!optional.importModule) throw new Error(`no importer for ${modulePath}`);
        return { exported: (await optional.importModule(modulePath)).default };
      }) as never,
    text: { scaffoldEntry: 'export default {};\n', reloadApprovalRequired: () => 'approve', restoreFailedReason: 'restore failed' },
    quarantineTelemetry: () => ({ event: {}, options: {} }),
  }, runtime);
  return { runtime: core, imports };
}

describe('runtime activation edges', () => {
  it('refuses an installed plugin whose package has no manifest with the load error, importing nothing', async () => {
    const installDir = await tempDir('edge-install-');
    await mkdir(path.join(installDir, 'no-manifest', '1.0.0', 'server'), { recursive: true });
    await writeFile(path.join(installDir, 'no-manifest', '1.0.0', 'server', 'index.mjs'), 'export default {};\n');
    const { runtime, imports } = host({ enabled: ['no-manifest'], runtime: { installDir } });
    const record = (await runtime.discoverPlugins()).find((candidate) => candidate.id === 'no-manifest');
    expect(record).toMatchObject({ source: 'site', status: 'invalid', manifest: undefined });
    const refused = await runtime.onPluginEnabled('no-manifest').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(PluginLoadError);
    expect(refused).toMatchObject({ pluginId: 'no-manifest', reason: 'PLUGIN_EXPORT_INVALID' });
    expect(imports).toEqual([]);
    expect(runtime.pluginLoadedVersion({ id: 'no-manifest' })).toBeUndefined();
    await runtime.dispose({}, {});
  });

  describe('declared content types', () => {
    const declared = manifestOf('typed', { contentTypes: [{ key: 'article' }] });
    function typedHost(applyError?: Error) {
      const applied: unknown[] = [];
      const contentTypes: DeclarativeContentTypesPort = {
        validateManifest: () => ({ errors: [] }),
        parse: () => ({ decls: [{ key: 'article', label: 'Article', fields: [] }], errors: [] }),
        plan: async ({ decls }) => ({ conflicts: [], items: decls }),
        apply: async (input) => { applied.push(input); if (applyError) throw applyError; },
      };
      const ports: DeclaredContentTypePorts = { findByKey: async () => null, register: async () => ({ ok: true }) };
      const setups: string[] = [];
      const built = host({ sources: [{ manifest: declared, setup: () => { setups.push('typed'); } }], enabled: ['typed'], runtime: { declaredContentTypes: ports }, contentTypes });
      return { ...built, applied, ports, setups };
    }

    it('creates the types through the host store after the code loads', async () => {
      const { runtime, applied, ports, setups } = typedHost();
      await runtime.onPluginEnabled('typed');
      expect(setups).toEqual(['typed']);
      expect(applied).toHaveLength(1);
      expect(applied[0]).toMatchObject({ workspaceId: WS, pluginId: 'typed' });
      expect((applied[0] as { ports: unknown }).ports).toBe(ports);
      expect(runtime.pluginLoadedVersion({ id: 'typed' })).toBe('1.0.0');
      await runtime.dispose({}, {});
    });

    it('unloads the code again and rethrows when a type fails to create after the code loaded', async () => {
      const failure = new Error('outbox unavailable');
      const { runtime, setups } = typedHost(failure);
      await expect(runtime.onPluginEnabled('typed')).rejects.toBe(failure);
      expect(setups).toEqual(['typed']);
      expect(runtime.pluginLoadedVersion({ id: 'typed' })).toBeUndefined();
      await runtime.dispose({}, {});
    });
  });

  it('a disable that lands while setup is still running retires that load: setup failed, nothing published', async () => {
    let release!: () => void;
    let started!: () => void;
    const setupStarted = new Promise<void>((resolve) => { started = resolve; });
    const { runtime } = host({
      sources: [{ manifest: manifestOf('slow'), setup: () => { started(); return new Promise<void>((resolve) => { release = resolve; }); } }],
      enabled: ['slow'],
    });
    const enabling = runtime.onPluginEnabled('slow').catch((error: unknown) => error);
    await setupStarted;
    runtime.onPluginDisabled('slow');
    release();
    const refused = await enabling;
    expect(refused).toBeInstanceOf(PluginLoadError);
    expect(refused).toMatchObject({ pluginId: 'slow', reason: 'PLUGIN_SETUP_FAILED' });
    expect(runtime.pluginLoadedVersion({ id: 'slow' })).toBeUndefined();
    await runtime.dispose({}, {});
  });

  it('publishes reviewed browser-provider assets with the plugin and retires them on disable', async () => {
    const root = await tempDir('edge-charts-');
    const files = { 'server/index.mjs': 'export default {};', 'client/provider.js': 'export function mount() {}' };
    for (const [file, bytes] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), bytes);
    }
    const manifest = manifestOf('charts', {
      capabilities: [],
      integrity: Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file, digest(bytes)])),
      browserProviders: [{ id: 'plugin.charts', kind: 'chart', contractVersion: 1, kinds: ['bar'], javascript: 'client/provider.js' }],
    });
    const approval: BundledBrowserProviderApproval = { pluginId: 'charts', version: '1.0.0', browserProviders: manifest.browserProviders!, integrity: { ...manifest.integrity } };
    const { runtime } = host({
      sources: [{ manifest, setup: () => {}, entryPath: path.join(root, 'server', 'index.mjs') }],
      enabled: ['charts'], runtime: { browserProviderApprovals: [approval] },
    });
    expect(runtime.browserProviders({})).toEqual({ generation: 0, providers: [] });
    await runtime.onPluginEnabled('charts');
    const published = runtime.browserProviders({});
    expect(published.generation).toBe(1);
    expect(published.providers.map((provider) => provider.pluginId)).toEqual(['charts']);
    const asset = published.providers[0]!.assets.find((candidate) => candidate.path === 'client/provider.js')!;
    expect(new TextDecoder().decode(asset.readBytes({}))).toBe('export function mount() {}');
    runtime.onPluginDisabled('charts');
    expect(runtime.browserProviders({})).toEqual({ generation: 2, providers: [] });
    // A second disable has nothing left to retire, so the generation stays put.
    runtime.onPluginDisabled('charts');
    expect(runtime.browserProviders({}).generation).toBe(2);
    await runtime.dispose({}, {});
  });
});
