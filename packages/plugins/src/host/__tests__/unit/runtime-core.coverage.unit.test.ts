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
  declarative?: Partial<typeof manifestHost.declarativeContentTypes>;
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
      capabilityVocabulary: ['content.read', 'content.extend', 'hooks.attach', 'tools.register', 'providers.register'], declarativeContentTypes: { ...manifestHost.declarativeContentTypes, ...options.declarative },
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

const toolClaimer = (id: string): PluginManifest => builtIn({ id, name: id, capabilities: [], contributes: { settings: ['theme'] } as never });

describe('conflicts', () => {
  it('refuses an enable that would take a name an enabled plugin holds, before importing its code', async () => {
    const h = await host({ sources: [source(toolClaimer('first-p')), source(toolClaimer('second-p'))], rows: [row('first-p', { updatedAt: '2029-01-01T00:00:00.000Z' })] });
    await h.runtime.onPluginEnabled('first-p');
    h.importer.mockClear();
    const error = await h.runtime.onPluginEnabled('second-p').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PluginConflictError);
    expect(h.importer).not.toHaveBeenCalled();
    const conflicts = await h.runtime.listPluginConflicts();
    expect([...conflicts.keys()]).toEqual(['second-p']);
    expect(conflicts.get('second-p')![0]).toMatchObject({ heldBy: 'first-p' });
  });

  it('reports no conflicts when nothing clashes', async () => {
    const h = await host({ sources: [source(builtIn())] });
    expect((await h.runtime.listPluginConflicts()).size).toBe(0);
  });

  it('reports what a staged install would clash with when it is previewed', async () => {
    const h = await host({ installDir: 'tmp', sources: [source(toolClaimer('held-p'))], rows: [row('held-p')] });
    await h.runtime.onPluginEnabled('held-p');
    await h.runtime.pluginSource!.create({ id: 'newcomer', name: 'N', description: 'd' }, {});
    const manifest = JSON.parse((await h.runtime.pluginSource!.read({ id: 'newcomer', path: 'jini.plugin.json' }, {})).content);
    await h.runtime.pluginSource!.write({ id: 'newcomer', path: 'jini.plugin.json', content: JSON.stringify({ ...manifest, capabilities: [], contributes: { settings: ['theme'] } }) }, {});
    const sealed = await h.runtime.pluginSource!.seal({ id: 'newcomer' }, {});
    expect(sealed.plugin.conflicts).toEqual([expect.objectContaining({ heldBy: 'held-p', kind: 'setting' })]);
  });
});

describe('boot', () => {
  it('re-attaches every enabled plugin of this workspace and skips other workspaces\' rows', async () => {
    const h = await host({ sources: [source(builtIn()), source(builtIn({ id: 'core-b', name: 'B' }))], rows: [row('core-a'), row('core-b', { workspaceId: 'other' as never })] });
    await h.runtime.attachEnabledPluginsAtBoot();
    expect(h.setups).toEqual(['core-a']);
    expect(h.runtime.pluginLoadedVersion({ id: 'core-a' })).toBe('1.0.0');
  });

  it('does nothing when no plugin is enabled here', async () => {
    const h = await host({ sources: [source(builtIn())], rows: [row('core-a', { enabled: false })] });
    await h.runtime.attachEnabledPluginsAtBoot();
    expect(h.importer).not.toHaveBeenCalled();
  });

  it('quarantines the newer of a conflicting enabled pair durably and keeps the older running', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = await host({ sources: [source(toolClaimer('old-p')), source(toolClaimer('new-p'))], rows: [row('old-p', { updatedAt: '2029-01-01T00:00:00.000Z' }), row('new-p', { updatedAt: '2030-01-01T00:00:00.000Z' })] });
    await h.runtime.attachEnabledPluginsAtBoot();
    const rows = await h.repo.listAll();
    expect(rows.find(r => r.pluginId === 'new-p')).toMatchObject({ enabled: false, quarantineFailureCount: 0, quarantineReason: expect.stringContaining('Turned off at startup because it claims things already in use') });
    expect(rows.find(r => r.pluginId === 'old-p')!.enabled).toBe(true);
    expect(h.setups).toEqual(['old-p']);
    expect(h.runtime.pluginLoadedVersion({ id: 'new-p' })).toBeUndefined();
    warn.mockRestore();
  });

  it('attaches nothing and detaches every enabled plugin when the conflict pass cannot finish', async () => {
    const h = await host({ sources: [source(builtIn())], rows: [row('core-a')] });
    await h.runtime.onPluginEnabled('core-a');
    expect(h.runtime.pluginLoadedVersion({ id: 'core-a' })).toBe('1.0.0');
    let calls = 0;
    const real = h.repo.listAll.bind(h.repo);
    vi.spyOn(h.repo, 'listAll').mockImplementation(async () => { if (++calls >= 3) throw new Error('db gone'); return real(); });
    await h.runtime.attachEnabledPluginsAtBoot();
    expect(h.runtime.pluginLoadedVersion({ id: 'core-a' })).toBeUndefined();
  });

  it('enables bundled defaults on first boot and reports bundled failures without blocking boot', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = await host({
      sources: [source(builtIn()), source(builtIn({ id: 'core-bad', name: 'Bad' }))], optional: { bundledEnabledIds: ['core-a', 'core-bad', 'not-bundled'] },
      importer: ({ manifest }) => async () => { if (manifest.id === 'core-bad') throw new Error('import exploded'); return { exported: { definition: { setup: () => {} } } }; },
    });
    await h.runtime.attachEnabledPluginsAtBoot();
    const rows = await h.repo.listAll();
    expect(rows.find(r => r.pluginId === 'core-a')).toMatchObject({ enabled: true });
    expect(rows.find(r => r.pluginId === 'core-bad')).toBeUndefined();
    expect(rows.find(r => r.pluginId === 'not-bundled')).toBeUndefined();
    expect(h.runtime.pluginLoadedVersion({ id: 'core-a' })).toBe('1.0.0');
    expect(warn.mock.calls.some(call => String(call[0]).includes("bundled initialization failed for 'core-bad'"))).toBe(true);
  });

  it('logs and continues when bundled discovery fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rc-disc-'));
    dirs.push(dir);
    const asFile = path.join(dir, 'f');
    await writeFile(asFile, 'x');
    const h = await host({ installDir: asFile, sources: [source(builtIn())], optional: { bundledEnabledIds: ['core-a'] } });
    vi.spyOn(h.runtime, 'discoverPlugins');
    await h.runtime.attachEnabledPluginsAtBoot();
    expect(warn.mock.calls.some(call => String(call[0]).includes('bundled discovery failed') || String(call[0]).includes('bundled initialization failed'))).toBe(true);
  });

  it('skips re-attaching a plugin that vanished from discovery and one declared as tier-1', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = await host({ sources: [source(builtIn())], rows: [row('core-a'), row('vanished')] });
    await h.runtime.attachEnabledPluginsAtBoot();
    expect(h.setups).toEqual(['core-a']);
    expect(warn.mock.calls.some(call => String(call[0]).includes("boot re-attach failed for 'vanished'"))).toBe(true);
  });
});

describe('declared content types', () => {
  const typed = builtIn({ id: 'typed-p', name: 'Typed', contentTypes: [{ key: 'note' }] as never });

  it('unloads the loaded code when applying the declared types fails after load', async () => {
    const boom = new Error('apply failed');
    const ports = { findByKey: vi.fn(), register: vi.fn() };
    const h = await host({ sources: [source(typed)], optional: { declaredContentTypes: ports as never },
      declarative: { plan: async () => ({ conflicts: [] }) as never, apply: async () => { throw boom; } } });
    await expect(h.runtime.onPluginEnabled('typed-p')).rejects.toBe(boom);
    expect(h.setups).toEqual(['typed-p']);
    expect(h.runtime.pluginLoadedVersion({ id: 'typed-p' })).toBeUndefined();
  });

  it('records the loaded version once the declared types are applied', async () => {
    const apply = vi.fn(async () => {});
    const plan = vi.fn(async () => ({ conflicts: [] }) as never);
    const ports = { findByKey: vi.fn(), register: vi.fn() };
    const h = await host({ sources: [source(typed)], optional: { declaredContentTypes: ports as never }, declarative: { plan, apply: apply as never } });
    await h.runtime.onPluginEnabled('typed-p');
    expect(plan).toHaveBeenCalledWith({ ports, workspaceId: WS, decls: [{ key: 'note' }] });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(h.runtime.pluginLoadedVersion({ id: 'typed-p' })).toBe('1.0.0');
  });
});

describe('invalid site records and installer wiring', () => {
  it('fails closed with PLUGIN_EXPORT_INVALID for a site record that has no valid manifest', async () => {
    const h = await host({ installDir: 'tmp' });
    const dir = path.join(h.installDir, 'broken-one', '1.0.0');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'jini.plugin.json'), '{ not json');
    const record = (await h.runtime.discoverPlugins()).find(r => r.id === 'broken-one');
    expect(record).toMatchObject({ status: 'invalid', manifest: undefined });
    await expect(h.runtime.onPluginEnabled('broken-one')).rejects.toMatchObject({ name: 'PluginLoadError', reason: 'PLUGIN_EXPORT_INVALID' });
  });

  it('serializes install through the host lookup with the previewed publisher identity', async () => {
    const withInstallIdentity = vi.fn(async ({ run }: { run: () => Promise<unknown> }) => run());
    const h = await host({ installDir: 'tmp', optional: { lookup: () => ({ getPlugin: vi.fn(), findProviders: vi.fn(), withInstallIdentity }) as never } });
    await sealSite(h, 'via-lookup');
    expect(withInstallIdentity).toHaveBeenCalledWith({ candidate: { id: 'unknown/via-lookup', localId: 'via-lookup', family: 'site-runtime' }, run: expect.any(Function) });
  });

  it('exposes no installer or source service without an install directory', async () => {
    const h = await host();
    expect(h.runtime.pluginInstaller).toBeUndefined();
    expect(h.runtime.pluginSource).toBeUndefined();
  });
});

describe('source reload of an enabled site plugin', () => {
  /** Seals `id`, approves its capability set and turns it on, returning the helper handles. */
  async function enabledSite(options: HostOptions = {}, id = 'reload-p') {
    const h = await host({ installDir: 'tmp', ...options });
    await sealSite(h, id);
    const manifest = (await h.runtime.discoverPlugins()).find(r => r.id === id)!.manifest!;
    await h.runtime.pluginSource!.recordApproval({ id, capabilities: pluginCapabilitySet({ manifest }) }, {});
    await h.repo.save(row(id, { version: '0.1.0' }));
    await h.runtime.onPluginEnabled(id);
    return h;
  }

  it('advances the active pointer and the loaded version on an approved re-seal', async () => {
    const h = await enabledSite();
    const result = await h.runtime.pluginSource!.seal({ id: 'reload-p' }, {});
    expect(result).toMatchObject({ installed: true, reloaded: true });
    expect(result.reloadError).toBeUndefined();
    expect((await h.repo.getActivation({ workspaceId: WS as never, pluginId: 'reload-p' }))!.version).toBe('0.1.1');
    expect(h.runtime.pluginLoadedVersion({ id: 'reload-p' })).toBe('0.1.1');
    await h.runtime.dispose({}, {});
  });

  it('keeps the approved version running when a re-seal widens capabilities', async () => {
    const h = await enabledSite();
    const src = h.runtime.pluginSource!;
    const current = JSON.parse((await src.read({ id: 'reload-p', path: 'jini.plugin.json' }, {})).content);
    await src.write({ id: 'reload-p', path: 'jini.plugin.json', content: JSON.stringify({ ...current, capabilities: ['content.read'] }) }, {});
    const result = await src.seal({ id: 'reload-p' }, {});
    expect(result).toMatchObject({ installed: true, reloaded: false, reloadError: 'NEED_APPROVAL capability:content.read' });
    expect((await h.repo.getActivation({ workspaceId: WS as never, pluginId: 'reload-p' }))!.version).toBe('0.1.0');
    expect(h.runtime.pluginLoadedVersion({ id: 'reload-p' })).toBe('0.1.0');
    await h.runtime.dispose({}, {});
  });

  it('restores the previous version when the new one fails to load', async () => {
    const h = await enabledSite({ importer: ({ manifest }) => async () => {
      if (manifest.version === '0.1.1') throw new Error('new version broken');
      return { exported: { definition: { setup: () => {} } } };
    } });
    const result = await h.runtime.pluginSource!.seal({ id: 'reload-p' }, {});
    expect(result).toMatchObject({ installed: true, reloaded: false });
    expect(result.reloadError).toContain('reload-p');
    const restored = await h.repo.getActivation({ workspaceId: WS as never, pluginId: 'reload-p' });
    expect(restored).toMatchObject({ enabled: true, version: '0.1.0' });
    expect(h.runtime.pluginLoadedVersion({ id: 'reload-p' })).toBe('0.1.0');
    await h.runtime.dispose({}, {});
  });

  it('quarantines the plugin with the host reason when the restored version cannot reload either', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let loads = 0;
    const h = await enabledSite({ importer: () => async () => {
      if (++loads > 1) throw new Error('everything broken');
      return { exported: { definition: { setup: () => {} } } };
    } });
    const result = await h.runtime.pluginSource!.seal({ id: 'reload-p' }, {});
    expect(result.reloaded).toBe(false);
    expect(await h.repo.getActivation({ workspaceId: WS as never, pluginId: 'reload-p' })).toMatchObject({ enabled: false, quarantineReason: 'restore failed', quarantineFailureCount: 0 });
    expect(h.runtime.pluginLoadedVersion({ id: 'reload-p' })).toBeUndefined();
    expect(warn.mock.calls.some(call => String(call[0]).includes("Plugin 'reload-p' restored-version reload failed"))).toBe(true);
    await h.runtime.dispose({}, {});
  });

  it('reloads activations of other workspaces without loading code here, and reports not-reloaded', async () => {
    const h = await host({ installDir: 'tmp' });
    await sealSite(h, 'elsewhere');
    await h.repo.save(row('elsewhere', { workspaceId: 'other' as never, version: '0.1.0' }));
    const manifest = (await h.runtime.discoverPlugins()).find(r => r.id === 'elsewhere')!.manifest!;
    await h.runtime.pluginSource!.recordApproval({ id: 'elsewhere', capabilities: pluginCapabilitySet({ manifest }) }, {});
    const result = await h.runtime.pluginSource!.seal({ id: 'elsewhere' }, {});
    expect(result).toMatchObject({ installed: true, reloaded: false });
    expect(result.reloadError).toBeUndefined();
    expect(h.importer).not.toHaveBeenCalled();
    expect((await h.repo.getActivation({ workspaceId: 'other' as never, pluginId: 'elsewhere' }))!.version).toBe('0.1.1');
    await h.runtime.dispose({}, {});
  });

  it('does not restore or reload locally when another workspace\'s activation fails to advance', async () => {
    const h = await host({ installDir: 'tmp' });
    await sealSite(h, 'broken-else');
    await h.repo.save(row('broken-else', { workspaceId: 'other' as never, version: '0.1.0' }));
    const manifest = (await h.runtime.discoverPlugins()).find(r => r.id === 'broken-else')!.manifest!;
    await h.runtime.pluginSource!.recordApproval({ id: 'broken-else', capabilities: pluginCapabilitySet({ manifest }) }, {});
    vi.spyOn(h.repo, 'save').mockRejectedValue(new Error('disk full'));
    const result = await h.runtime.pluginSource!.seal({ id: 'broken-else' }, {});
    expect(result).toMatchObject({ reloaded: false, reloadError: 'disk full' });
    expect(h.importer).not.toHaveBeenCalled();
  });
});

// BUG (RED, behaviour deliberately unchanged): `src/host/provider-contributions.ts:171` uses
// `PLUGIN_PROVIDER_CAPABILITY` without importing it (lost in the wave-B import rewrite), so validating
// ANY manifest that declares `contributes.providers` throws `ReferenceError`. These tests state the
// correct behaviour and fail until that one import is restored.
describe('provider plugins', () => {
  const providerManifest = (id: string): PluginManifest => builtIn({
    id, name: id, capabilities: ['providers.register'],
    contributes: { providers: [{ contract: 'search', id: `${id}-engine`, contractVersion: 1 }] } as never,
  });

  it('lists enabled provider plugins with their declarations (manifest only)', async () => {
    const h = await host({ sources: [source(providerManifest('prov-a')), source(builtIn())], rows: [row('prov-a'), row('core-a')] });
    expect(await h.runtime.listProviderPlugins({}, {})).toEqual([
      { pluginId: 'prov-a', providers: [{ contract: 'search', id: 'prov-a-engine', contractVersion: 1 }] },
    ]);
  });

  it('loads only the requested, enabled provider plugins and never at enable time', async () => {
    const h = await host({ sources: [source(providerManifest('prov-a')), source(providerManifest('prov-off')), source(builtIn())], rows: [row('prov-a'), row('core-a')] });
    expect(await h.runtime.loadProviderPlugins({ pluginIds: [] }, {})).toEqual([]);
    await h.runtime.onPluginEnabled('prov-a');
    expect(h.importer).not.toHaveBeenCalled();
    expect(await h.runtime.loadProviderPlugins({ pluginIds: ['prov-a', 'prov-off', 'core-a'] }, {})).toEqual(['prov-a']);
    expect(h.setups).toEqual(['prov-a']);
  });

  it('skips a provider plugin on boot re-attach because loadProviderPlugins owns it', async () => {
    const h = await host({ sources: [source(providerManifest('prov-a'))], rows: [row('prov-a')] });
    await h.runtime.attachEnabledPluginsAtBoot();
    expect(h.importer).not.toHaveBeenCalled();
  });

  it('logs and skips a provider plugin that fails to load, retiring its selection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = await host({ sources: [source(providerManifest('prov-a'))], rows: [row('prov-a')], importer: () => async () => { throw new Error('provider import failed'); } });
    expect(await h.runtime.loadProviderPlugins({ pluginIds: ['prov-a'] }, {})).toEqual([]);
    expect(warn.mock.calls.some(call => String(call[0]).includes("provider plugin 'prov-a' failed to load; its contract stays on the noop"))).toBe(true);
  });

  it('abandons a provider plugin whose load outlasts the deadline', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = await host({ sources: [source(providerManifest('prov-a'))], rows: [row('prov-a')], importer: () => () => new Promise(() => {}) });
    expect(await h.runtime.loadProviderPlugins({ pluginIds: ['prov-a'] }, { timeoutMs: 20 })).toEqual([]);
    expect(warn.mock.calls.some(call => String(call[0]).includes('provider plugin load timed out after 20 ms'))).toBe(true);
  });

  it('starts with an empty browser provider generation', async () => {
    const h = await host();
    expect(h.runtime.browserProviders({}, {})).toEqual({ generation: 0, providers: [] });
  });
});
