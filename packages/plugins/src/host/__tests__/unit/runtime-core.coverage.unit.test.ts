/**
 * @file Behaviour tests for `createPluginRuntimeCore` paths the second-host test does not reach:
 * the package-files viewer, site-plugin enable/reload through the real source service on a temp
 * install directory, provider plugins, boot re-attach and conflict handling, and uninstall paths.
 * Every host dependency is an injected fake; only the filesystem under a temp dir is real.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPluginInvocationBinding, createPluginRuntimeCore, PluginPackagePathError, PluginUninstallPathError, type PluginRuntimeCoreOptional, type PluginRuntimeSource } from '../../node/index.js';
import { PluginConflictError } from '../../plugin-claims.js';
import type { PluginManifest } from '../../manifest.js';
import { pluginCapabilitySet } from '../../source-policy.js';
import { InMemoryPluginActivationRepo } from '../../repo.memory.js';
import type { PluginActivationRecord } from '../../activation.js';
import { manifestHost, pluginSdkBinding as baseBinding } from '../support/fixture-bindings.js';

const HOOK = 'record.preCommit';
const WS = 'ws';
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

const builtIn = (over: Partial<PluginManifest> = {}): PluginManifest => ({
  id: 'core-a', name: 'Core A', version: '1.0.0', sdkRange: '>=0.0.0', engine: 1, tier: 'tier-3', capabilities: [], hooks: [], fields: [], integrity: {}, ...over,
});
const row = (pluginId: string, over: Partial<PluginActivationRecord> = {}): PluginActivationRecord => ({
  pluginId, workspaceId: WS as never, version: '1.0.0', enabled: true, updatedAt: '2030-01-01T00:00:00.000Z', ...over,
});

interface HostOptions {
  sources?: PluginRuntimeSource[];
  rows?: PluginActivationRecord[];
  installDir?: string | 'tmp';
  importer?: (required: { manifest: PluginManifest; source: 'built-in' | 'site' }, optional: { importModule?: (p: string) => Promise<unknown> }) => unknown;
  optional?: PluginRuntimeCoreOptional;
  localInstall?: boolean;
  tier2?: (...args: never[]) => Promise<unknown>;
}

async function host(options: HostOptions = {}) {
  const installDir = options.installDir === 'tmp' ? await mkdtemp(path.join(os.tmpdir(), 'rc-cov-')) : options.installDir;
  if (installDir) dirs.push(installDir, `${installDir}-runtime`, `${installDir}-trash`);
  const repo = new InMemoryPluginActivationRepo({ initialRows: options.rows ?? [] });
  const setups: string[] = [];
  const importer = vi.fn(options.importer ?? ((required: { manifest: PluginManifest }) => async () => ({ exported: { definition: { setup: () => { setups.push(required.manifest.id); } } } })));
  const tier2 = vi.fn(options.tier2 ?? (async () => { throw new Error('tier2 runner'); }));
  const capture = vi.fn();
  const runtime = createPluginRuntimeCore({
    workspaceId: WS, clock: { nowMs: () => Date.parse('2030-01-01T00:00:00.000Z') } as never, activationRepo: repo, sources: options.sources ?? [],
    pluginSourcePolicy: { localInstallEnabled: () => options.localInstall ?? true, confirmEnable: () => true },
    tier2CallRunner: tier2 as never,
    pluginSdkBinding: { ...baseBinding, hookIds: [HOOK], beforeSaveHook: HOOK, hookSemantics: { [HOOK]: 'shared' } },
    hostBinding: {
      capabilityVocabulary: ['content.read', 'content.extend', 'hooks.attach'], declarativeContentTypes: manifestHost.declarativeContentTypes,
      coreOwnerName: 'Acme core', identityNamespace: 'ns', localInstallDisabledMessage: 'install off',
      tierPolicy: { execution: 'in-process', allowLoad: () => true, siteErrors: () => [], checkInstall: () => {} },
      archiveReader: async () => { throw new Error('no archive'); }, verifyDigest: async ({ absoluteFilePath }) => `sha256-${createHash('sha256').update(await readFile(absoluteFilePath)).digest('hex')}`,
      createInvocationCoreDeps: ({ pluginId, declaredHooks }) => createPluginInvocationBinding({ pluginId, declaredHooks, beforeSaveHook: HOOK }, {}),
    },
    createModuleImporter: importer as never,
    text: { scaffoldEntry: 'export default {};\n', reloadApprovalRequired: ({ added }) => `NEED_APPROVAL ${added.join('+')}`, restoreFailedReason: 'restore failed' },
    quarantineTelemetry: ({ pluginId }) => ({ event: { pluginId }, options: {} }),
  }, { ...(installDir ? { installDir } : {}), ...options.optional });
  return { runtime, repo, importer, setups, tier2, capture, installDir: installDir as string };
}

const source = (manifest: PluginManifest, over: Partial<PluginRuntimeSource> = {}): PluginRuntimeSource =>
  ({ source: 'built-in', manifest, entryPath: `builtin:${manifest.id}`, importModule: async () => ({}), ...over });

describe('package files viewer', () => {
  it('lists a built-in\'s own source directory', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rc-pkg-'));
    dirs.push(dir);
    await writeFile(path.join(dir, 'a.txt'), 'hello');
    const { runtime } = await host({ sources: [source(builtIn(), { sourceDir: dir })] });
    const [record] = await runtime.discoverPlugins();
    const out = await runtime.readPluginPackageFiles(record!);
    expect(out.truncated).toBe(false);
    expect(out.files.map(f => [f.relativePath, f.content])).toEqual([['a.txt', 'hello']]);
  });

  it('returns an empty listing for a built-in without a source directory and for a site record with no install directory', async () => {
    const { runtime } = await host({ sources: [source(builtIn())] });
    const [record] = await runtime.discoverPlugins();
    expect(await runtime.readPluginPackageFiles(record!)).toEqual({ files: [], truncated: false });
    expect(await runtime.readPluginPackageFiles({ ...record!, source: 'site' })).toEqual({ files: [], truncated: false });
  });

  it('refuses a site record whose id or version is not one safe path segment', async () => {
    const { runtime } = await host({ installDir: 'tmp' });
    const base = { id: 'ok-id', name: 'n', version: '1.0.0', source: 'site' as const, status: 'valid' as const, errors: [] };
    await expect(runtime.readPluginPackageFiles({ ...base, id: '../evil' })).rejects.toBeInstanceOf(PluginPackagePathError);
    await expect(runtime.readPluginPackageFiles({ ...base, version: '../1' })).rejects.toThrow("plugin 'ok-id' version '../1' is not a safe path segment");
  });

  it('lists a sealed site plugin from <installDir>/<id>/<version>', async () => {
    const h = await host({ installDir: 'tmp' });
    await h.runtime.pluginSource!.create({ id: 'site-one', name: 'Site One', description: 'd' }, {});
    await h.runtime.pluginSource!.seal({ id: 'site-one' }, {});
    const record = (await h.runtime.discoverPlugins()).find(r => r.id === 'site-one')!;
    const files = await h.runtime.readPluginPackageFiles(record);
    expect(files.files.map(f => f.relativePath)).toEqual(expect.arrayContaining(['jini.plugin.json', 'server/index.mjs']));
  });
});

describe('uninstall path location', () => {
  it('refuses without an install directory and reports a live or absent package', async () => {
    const none = await host();
    await expect(none.runtime.locatePluginPackageDirs('x')).rejects.toThrow("no installDir configured for this composition root — cannot remove 'x'");
    const h = await host({ installDir: 'tmp' });
    expect(await h.runtime.locatePluginPackageDirs('absent-one')).toMatchObject({ liveNames: [] });
    await mkdir(path.join(h.installDir, 'present-one'), { recursive: true });
    expect((await h.runtime.locatePluginPackageDirs('present-one')).liveNames).toEqual(['present-one']);
  });

  it('refuses ids outside the safe segment allowlist', async () => {
    const h = await host({ installDir: 'tmp' });
    for (const bad of ['..', 'a/b', 'UPPER', '']) await expect(h.runtime.locatePluginPackageDirs(bad)).rejects.toBeInstanceOf(PluginUninstallPathError);
  });

  it('rethrows filesystem errors other than ENOENT', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rc-file-'));
    dirs.push(dir);
    const asFile = path.join(dir, 'install-is-a-file');
    await writeFile(asFile, 'x');
    const h = await host({ installDir: asFile });
    await expect(h.runtime.locatePluginPackageDirs('child')).rejects.toMatchObject({ code: 'ENOTDIR' });
  });
});

/** Creates and seals a site plugin through the real source service, optionally with manifest overrides. */
async function sealSite(h: Awaited<ReturnType<typeof host>>, id: string, over: Record<string, unknown> = {}): Promise<void> {
  const src = h.runtime.pluginSource!;
  await src.create({ id, name: `Plugin ${id}`, description: 'd' }, {});
  if (Object.keys(over).length) {
    const current = JSON.parse((await src.read({ id, path: 'jini.plugin.json' }, {})).content) as Record<string, unknown>;
    await src.write({ id, path: 'jini.plugin.json', content: JSON.stringify({ ...current, ...over }) }, {});
  }
  const sealed = await src.seal({ id }, {});
  expect(sealed.installed).toBe(true);
}

describe('site plugin enable and disable', () => {
  it('loads through the contained snapshot importer, records the loaded version and unloads on disable', async () => {
    const h = await host({ installDir: 'tmp' });
    await sealSite(h, 'site-a');
    await h.runtime.onPluginEnabled('site-a');
    expect(h.importer).toHaveBeenCalledWith({ manifest: expect.objectContaining({ id: 'site-a' }), source: 'site' }, expect.objectContaining({ snapshots: expect.anything() }));
    expect(h.setups).toEqual(['site-a']);
    expect(h.runtime.pluginLoadedVersion({ id: 'site-a' })).toBe('0.1.0');
    h.runtime.onPluginDisabled('site-a');
    expect(h.runtime.pluginLoadedVersion({ id: 'site-a' })).toBeUndefined();
    await h.runtime.dispose({}, {});
  });

  it('attaches a declared beforeSave filter and runs it, then detaches on disable', async () => {
    const filter = vi.fn(async () => ({}));
    const h = await host({ installDir: 'tmp', importer: () => async () => ({ exported: { definition: { setup: (sdk: { addFilter: (hook: string, f: unknown) => void }) => sdk.addFilter(HOOK, filter) } } }) });
    await sealSite(h, 'site-hook', { capabilities: ['hooks.attach'], hooks: [HOOK] });
    await h.runtime.onPluginEnabled('site-hook');
    await h.runtime.beforeSaveHook({ workspaceId: WS, sku: 'A', ext: {} } as never);
    expect(filter).toHaveBeenCalledTimes(1);
    h.runtime.onPluginDisabled('site-hook');
    await h.runtime.beforeSaveHook({ workspaceId: WS, sku: 'A', ext: {} } as never);
    expect(filter).toHaveBeenCalledTimes(1);
    await h.runtime.dispose({}, {});
  });

  it('refuses a plugin that declares a hook but never attaches a filter', async () => {
    const h = await host({ installDir: 'tmp' });
    await sealSite(h, 'site-nofilter', { capabilities: ['hooks.attach'], hooks: [HOOK] });
    await expect(h.runtime.onPluginEnabled('site-nofilter')).rejects.toMatchObject({ name: 'PluginLoadError', reason: 'PLUGIN_HOOK_NOT_ATTACHED' });
    await h.runtime.dispose({}, {});
  });

  it('refuses an id that discovery does not know', async () => {
    const h = await host({ installDir: 'tmp' });
    await expect(h.runtime.onPluginEnabled('ghost')).rejects.toMatchObject({ name: 'PluginLoadError', reason: 'PLUGIN_EXPORT_INVALID' });
    await h.runtime.dispose({}, {});
  });

  it('does not publish a generation that was disabled while its import was in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const h = await host({ installDir: 'tmp', importer: () => async () => { await gate; return { exported: { definition: { setup: () => {} } } }; } });
    await sealSite(h, 'site-race');
    const pending = h.runtime.onPluginEnabled('site-race');
    const outcome = pending.catch((e: unknown) => e);
    await vi.waitFor(() => expect(h.importer).toHaveBeenCalled());
    h.runtime.onPluginDisabled('site-race');
    release();
    expect(await outcome).toMatchObject({ name: 'PluginLoadError', reason: 'PLUGIN_SETUP_FAILED' });
    expect(h.runtime.pluginLoadedVersion({ id: 'site-race' })).toBeUndefined();
    await h.runtime.dispose({}, {});
  });

  it('rejects new attachments after dispose with a closed-snapshots error', async () => {
    const h = await host({ installDir: 'tmp' });
    await sealSite(h, 'site-closed');
    await h.runtime.dispose({}, {});
    await expect(h.runtime.onPluginEnabled('site-closed')).rejects.toMatchObject({ code: 'SNAPSHOTS_CLOSED' });
  });

  it('never imports a built-in tier-2 plugin in-process: its code runs only through the host runner', async () => {
    const t2 = builtIn({ id: 'tier-two', tier: 'tier-2' as never });
    const h = await host({ sources: [source(t2)] });
    await expect(h.runtime.onPluginEnabled('tier-two')).rejects.toBeDefined();
    expect(h.importer).not.toHaveBeenCalled();
    await h.runtime.dispose({}, {});
  });

  it('exposes plugin lookup to the SDK only when the host supplies one', async () => {
    const seen: unknown[] = [];
    const importer = () => async () => ({ exported: { definition: { setup: (sdk: { plugins?: unknown }) => { seen.push(sdk.plugins); } } } });
    const lookup = { getPlugin: vi.fn(), findProviders: vi.fn(), withInstallIdentity: vi.fn() };
    const withLookup = await host({ sources: [source(builtIn())], importer, optional: { lookup: () => lookup as never } });
    await withLookup.runtime.onPluginEnabled('core-a');
    const without = await host({ sources: [source(builtIn())], importer });
    await without.runtime.onPluginEnabled('core-a');
    expect(seen[0]).toBeDefined();
    expect(seen[1]).toBeUndefined();
  });
});
