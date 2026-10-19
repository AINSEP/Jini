import { afterEach, describe, expect, it, vi } from 'vitest';
import * as filesystem from 'node:fs/promises';
import { link, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PluginManifest } from '../../manifest.js';
import { LEGACY_PLUGIN_MANIFEST_FILENAME, PLUGIN_MANIFEST_FILENAME } from '../../plugin-format.js';
import {
  assertPluginInstallIdle, computePluginIntegrity, digestSitePluginSnapshot, installSitePlugin, previewSitePluginInstall,
  pruneSitePluginVersions, snapshotSitePluginPackage, type PluginInstallDeps, type PluginSnapshotLimits,
} from '../../node/install.js';
import { manifestHost } from '../support/fixture-bindings.js';

// rename faults drive the publish rollback branches and handle hooks the read-race guards;
// every other call passes through.
const renameFaults: Array<(from: string, to: string) => boolean> = [];
type Handle = Awaited<ReturnType<typeof import('node:fs/promises')['open']>>;
let handleHook: ((handle: Handle) => Handle) | undefined;
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual,
    rename: async (from: string, to: string) => {
      if (renameFaults.some((fault) => fault(String(from), String(to)))) throw Object.assign(new Error('rename fault'), { code: 'EIO' });
      return actual.rename(from, to);
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      return handleHook ? handleHook(handle) : handle;
    } };
});

const roots: string[] = [];
afterEach(async () => {
  renameFaults.length = 0; handleHook = undefined;
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const sha = (bytes: string | Buffer) => `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
const tempRoot = async () => { const root = await mkdtemp(path.join(tmpdir(), 'site-plugin-install-')); roots.push(root); return root; };
const baseManifest = (id: string, version = '1.0.0'): PluginManifest => ({
  id, name: 'Install fixture', version, sdkRange: '^0.1.0', engine: 1, tier: 'tier-1',
  capabilities: [], hooks: [], fields: [], integrity: {}, extensions: { tovu: { id: `vendor/${id}` } },
});
async function writePackage(dir: string, manifest: object, files: Record<string, string> = {}, { integrity = true, filename = PLUGIN_MANIFEST_FILENAME } = {}) {
  await mkdir(dir, { recursive: true });
  for (const [key, text] of Object.entries(files)) { await mkdir(path.dirname(path.join(dir, key)), { recursive: true }); await writeFile(path.join(dir, key), text); }
  const map = Object.fromEntries(Object.entries(files).map(([key, text]) => [key, sha(text)]));
  await writeFile(path.join(dir, filename), JSON.stringify(integrity ? { ...manifest, integrity: map } : manifest));
  return dir;
}
function makeDeps(root: string, overrides: Partial<PluginInstallDeps> = {}): PluginInstallDeps {
  return { ...manifestHost, installDir: path.join(root, 'plugins'), builtInIds: [], repo: { listAll: async () => [] },
    conflicts: async () => [], archiveReader: async () => new Map<string, Uint8Array>(),
    tierPolicy: { siteErrors: () => [], checkInstall: () => {}, allowLoad: () => true, execution: 'in-process' as const }, warn: () => {}, ...overrides };
}
const withoutWarn = ({ warn: _warn, ...deps }: PluginInstallDeps): PluginInstallDeps => deps;
async function installFrom(sourceDir: string, deps: PluginInstallDeps, extra: { replace?: boolean } = {}) {
  const preview = await previewSitePluginInstall({ sourceDir, deps, ...extra });
  return installSitePlugin({ sourceDir, expectedDigest: preview.digest, deps, ...extra });
}
const installedVersions = async (deps: PluginInstallDeps, id: string) => (await readdir(path.join(deps.installDir, id))).sort();

describe('install lock and helpers', () => {
  it('assertPluginInstallIdle refuses only while the lock folder exists', async () => {
    const root = await tempRoot(); const installDir = path.join(root, 'plugins');
    await expect(assertPluginInstallIdle({ installDir })).resolves.toBeUndefined();
    await mkdir(installDir + '-install-lock', { recursive: true });
    await expect(assertPluginInstallIdle({ installDir })).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_BUSY' });
  });

  it('exists() rethrows faults other than ENOENT', async () => {
    const root = await tempRoot(); const file = path.join(root, 'file'); await writeFile(file, 'x');
    await expect(assertPluginInstallIdle({ installDir: path.join(file, 'plugins') })).rejects.toMatchObject({ code: 'ENOTDIR' });
  });

  it('digest is order independent and integrity omits manifests', async () => {
    const a = digestSitePluginSnapshot({ files: new Map([['b', Buffer.from('2')], ['a', Buffer.from('1')], ['c', Buffer.from('3')]]) });
    const b = digestSitePluginSnapshot({ files: new Map([['c', Buffer.from('3')], ['a', Buffer.from('1')], ['b', Buffer.from('2')]]) });
    expect(a).toBe(b);
    const source = await writePackage(path.join(await tempRoot(), 'src'), baseManifest('x'), { 'README.md': 'hi' });
    expect(await computePluginIntegrity({ sourceDir: source })).toEqual({ 'README.md': sha('hi') });
  });

  it('install reports busy when the lock already exists', async () => {
    const root = await tempRoot(); const deps = makeDeps(root);
    const source = await writePackage(path.join(root, 'src'), baseManifest('busy'));
    const preview = await previewSitePluginInstall({ sourceDir: source, deps });
    await mkdir(deps.installDir + '-install-lock', { recursive: true });
    await expect(installSitePlugin({ sourceDir: source, expectedDigest: preview.digest, deps })).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_BUSY' });
  });

  it('lock creation rethrows faults other than EEXIST', async () => {
    const root = await tempRoot(); const deps = makeDeps(root);
    const source = await writePackage(path.join(root, 'src'), baseManifest('lockfault'));
    const preview = await previewSitePluginInstall({ sourceDir: source, deps });
    await writeFile(path.join(root, 'plugins-install-lock-parent'), 'x');
    const blocked = makeDeps(root, { installDir: path.join(root, 'plugins-install-lock-parent', 'plugins') });
    await expect(installSitePlugin({ sourceDir: source, expectedDigest: preview.digest, deps: blocked })).rejects.toMatchObject({ code: 'ENOTDIR' });
    const sealed = path.join(root, 'sealed'); await mkdir(sealed); await filesystem.chmod(sealed, 0o555);
    try {
      await expect(installSitePlugin({ sourceDir: source, expectedDigest: preview.digest, deps: makeDeps(root, { installDir: path.join(sealed, 'plugins') }) })).rejects.toMatchObject({ code: 'EACCES' });
    } finally { await filesystem.chmod(sealed, 0o755); }
  });
});

/** FileHandle methods use private fields, so overrides sit on a Proxy bound to the real handle. */
function wrap(handle: Handle, overrides: Record<string, unknown>): Handle {
  return new Proxy(handle, { get: (target, key) => {
    if (typeof key === 'string' && key in overrides) return overrides[key];
    const value = Reflect.get(target, key) as unknown;
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
/** Reports one extra byte past the stat()'d size, as a file growing mid-read would. */
function grow(handle: Handle): Handle {
  let extra = true;
  return wrap(handle, { read: async (buffer: Buffer, offset: number, length: number, position: null) => {
    const result = await handle.read(buffer, offset, length, position);
    if (result.bytesRead === 0 && extra) { extra = false; buffer[offset] = 0x21; return { bytesRead: 1, buffer }; }
    return result;
  } });
}

describe('snapshot boundaries', () => {
  it('rejects invalid limits, too many entries and oversized files', async () => {
    const source = await writePackage(path.join(await tempRoot(), 'src'), baseManifest('x'), { 'a.md': 'aaaa', 'b.md': 'b' });
    await expect(snapshotSitePluginPackage({ sourceDir: source }, { maxEntries: 0 })).rejects.toMatchObject({ code: 'PLUGIN_SNAPSHOT_LIMIT_INVALID' });
    await expect(snapshotSitePluginPackage({ sourceDir: source }, { maxEntries: 1.5 })).rejects.toMatchObject({ code: 'PLUGIN_SNAPSHOT_LIMIT_INVALID' });
    await expect(snapshotSitePluginPackage({ sourceDir: source }, { maxEntries: 2 })).rejects.toMatchObject({ code: 'PLUGIN_PACKAGE_TOO_LARGE' });
    await expect(snapshotSitePluginPackage({ sourceDir: source }, { maxFileBytes: 3 })).rejects.toMatchObject({ code: 'PLUGIN_PACKAGE_TOO_LARGE' });
    await expect(snapshotSitePluginPackage({ sourceDir: source }, { maxTotalBytes: 4 })).rejects.toMatchObject({ code: 'PLUGIN_PACKAGE_TOO_LARGE' });
    const snap = await snapshotSitePluginPackage({ sourceDir: source }, { maxEntries: undefined } as unknown as PluginSnapshotLimits);
    expect([...snap.keys()].sort()).toEqual(['a.md', 'b.md', PLUGIN_MANIFEST_FILENAME]);
    expect(snap.entryCount).toBe(3);
  });

  it.each([
    ['a swapped inode', (handle: Handle) => wrap(handle, { stat: async () => ({ ...(await handle.stat()), isFile: () => true, ino: -1 }) }), {}, 'PLUGIN_PACKAGE_UNSAFE'],
    ['a file that is not a file anymore', (handle: Handle) => wrap(handle, { stat: async () => ({ ...(await handle.stat()), isFile: () => false }) }), {}, 'PLUGIN_PACKAGE_UNSAFE'],
    ['growth past the file limit', grow, { maxFileBytes: 4 }, 'PLUGIN_PACKAGE_TOO_LARGE'],
    ['growth past the total limit', grow, { maxTotalBytes: 4 }, 'PLUGIN_PACKAGE_TOO_LARGE'],
    ['growth within the limits', grow, {}, 'PLUGIN_PACKAGE_UNSAFE'],
    ['a shrink after reading', (handle: Handle) => { let calls = 0; return wrap(handle, { stat: async () => { const info = await handle.stat(); return ++calls === 2 ? Object.assign(info, { size: 0 }) : info; } }); }, {}, 'PLUGIN_PACKAGE_UNSAFE'],
  ] as const)('refuses %s while reading', async (_label, hook, limits, code) => {
    const source = path.join(await tempRoot(), 'src'); await mkdir(source); await writeFile(path.join(source, 'a.md'), 'abcd');
    handleHook = hook;
    await expect(snapshotSitePluginPackage({ sourceDir: source }, limits)).rejects.toMatchObject({ code });
  });

  it('walks nested folders and refuses symbolic links, hard links and a linked root', async () => {
    const root = await tempRoot();
    const nested = await writePackage(path.join(root, 'nested'), baseManifest('x'), { 'docs/a.md': 'a' });
    expect([...(await snapshotSitePluginPackage({ sourceDir: nested })).keys()]).toContain('docs/a.md');
    await expect(snapshotSitePluginPackage({ sourceDir: path.join(nested, 'docs', 'a.md') })).rejects.toMatchObject({ code: 'PLUGIN_PACKAGE_UNSAFE' });
    const linked = await writePackage(path.join(root, 'linked'), baseManifest('x'));
    await symlink(path.join(nested, 'docs', 'a.md'), path.join(linked, 'a.md'));
    await expect(snapshotSitePluginPackage({ sourceDir: linked })).rejects.toMatchObject({ code: 'PLUGIN_PACKAGE_UNSAFE', message: 'Symbolic links are not allowed.' });
    const hard = await writePackage(path.join(root, 'hard'), baseManifest('x'), { 'a.md': 'a' });
    await link(path.join(hard, 'a.md'), path.join(root, 'hard-alias'));
    await expect(snapshotSitePluginPackage({ sourceDir: hard })).rejects.toMatchObject({ code: 'PLUGIN_PACKAGE_UNSAFE' });
  });

  it('refuses a missing, linked or overlapping source folder', async () => {
    const root = await tempRoot(); const deps = makeDeps(root);
    await expect(previewSitePluginInstall({ sourceDir: path.join(root, 'missing'), deps })).rejects.toMatchObject({ code: 'PLUGIN_SOURCE_INVALID' });
    const source = await writePackage(path.join(root, 'src'), baseManifest('x'));
    await symlink(source, path.join(root, 'alias'));
    await expect(previewSitePluginInstall({ sourceDir: path.join(root, 'alias'), deps })).rejects.toMatchObject({ code: 'PLUGIN_PACKAGE_UNSAFE' });
    const insideStaging = await writePackage(path.join(root, 'plugins-staging', 'pkg'), baseManifest('x'));
    await expect(previewSitePluginInstall({ sourceDir: insideStaging, deps })).rejects.toMatchObject({ code: 'PLUGIN_SOURCE_INVALID' });
    await expect(previewSitePluginInstall({ sourceDir: root, deps })).rejects.toMatchObject({ code: 'PLUGIN_SOURCE_INVALID' });
  });

  it('a canonical() fault other than ENOENT propagates', async () => {
    const root = await tempRoot(); await writeFile(path.join(root, 'file'), 'x');
    const source = await writePackage(path.join(root, 'src'), baseManifest('x'));
    await mkdir(path.join(root, 'loop'));
    await symlink(path.join(root, 'loop', 'self'), path.join(root, 'loop', 'self'));
    await expect(previewSitePluginInstall({ sourceDir: source, deps: makeDeps(root, { installDir: path.join(root, 'loop', 'self', 'plugins') }) })).rejects.toMatchObject({ code: 'ELOOP' });
  });
});

describe('package validation', () => {
  it('reads an archive through the archive reader port', async () => {
    const root = await tempRoot();
    const manifestBytes = new TextEncoder().encode(JSON.stringify(baseManifest('archived')));
    const deps = makeDeps(root, { archiveReader: async () => new Map([[PLUGIN_MANIFEST_FILENAME, manifestBytes]]) });
    expect((await previewSitePluginInstall({ archive: new Uint8Array([1]), deps })).id).toBe('archived');
  });

  it.each([
    ['no manifest', async (dir: string) => { await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 'a.md'), 'a'); }, 'PLUGIN_MANIFEST_INVALID'],
    ['broken json', async (dir: string) => { await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, PLUGIN_MANIFEST_FILENAME), '{'); }, 'PLUGIN_MANIFEST_INVALID'],
    ['null manifest', async (dir: string) => { await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, PLUGIN_MANIFEST_FILENAME), 'null'); }, 'PLUGIN_MANIFEST_INVALID'],
    ['built-in shadow', (dir: string) => writePackage(dir, baseManifest('Word-Count')), 'PLUGIN_SHADOWS_BUILT_IN'],
    ['schema errors', (dir: string) => writePackage(dir, { ...baseManifest('x'), capabilities: 'nope' }), 'PLUGIN_MANIFEST_INVALID'],
    ['an invalid SDK range', (dir: string) => writePackage(dir, { ...baseManifest('x'), sdkRange: 'not a range' }), 'PLUGIN_MANIFEST_INVALID'],
    ['tier-1 code', (dir: string) => writePackage(dir, baseManifest('x'), { 'run.js': '1' }), 'PLUGIN_MANIFEST_INVALID'],
    ['tier-3 without server', (dir: string) => writePackage(dir, { ...baseManifest('x'), tier: 'tier-3' }), 'PLUGIN_MANIFEST_INVALID'],
    ['missing integrity', (dir: string) => writePackage(dir, { ...baseManifest('x'), integrity: undefined }, {}, { integrity: false }), 'PLUGIN_MANIFEST_INVALID'],
    ['array integrity', (dir: string) => writePackage(dir, { ...baseManifest('x'), integrity: [] }, {}, { integrity: false }), 'PLUGIN_MANIFEST_INVALID'],
    ['unlisted file', (dir: string) => writePackage(dir, baseManifest('x'), { 'a.md': 'a' }, { integrity: false }), 'PLUGIN_INTEGRITY_INVALID'],
    ['hash mismatch', (dir: string) => writePackage(dir, { ...baseManifest('x'), integrity: { 'a.md': sha('b') } }, { 'a.md': 'a' }, { integrity: false }), 'PLUGIN_INTEGRITY_INVALID'],
  ] as const)('refuses %s', async (_label, build, code) => {
    const root = await tempRoot(); const dir = path.join(root, 'src'); await build(dir);
    await expect(previewSitePluginInstall({ sourceDir: dir, deps: makeDeps(root, { builtInIds: ['word-count'] }) })).rejects.toMatchObject({ code });
  });

  it('tier-3 packages go through the tier policy', async () => {
    const root = await tempRoot(); const checkInstall = vi.fn(() => { throw Object.assign(new Error('blocked'), { code: 'TIER_BLOCKED' }); });
    const dir = await writePackage(path.join(root, 'src'), { ...baseManifest('x'), tier: 'tier-3' }, { 'server/index.mjs': 'export {}' });
    const deps = makeDeps(root, { tierPolicy: { siteErrors: () => [], checkInstall, allowLoad: () => true, execution: 'in-process' } });
    await expect(previewSitePluginInstall({ sourceDir: dir, deps })).rejects.toMatchObject({ code: expect.any(String) });
  });
});

describe('destination admission', () => {
  it('installs, upgrades with retirement, replaces explicitly and refuses downgrades', async () => {
    const root = await tempRoot(); const deps = makeDeps(root);
    const v1 = await writePackage(path.join(root, 'v1'), baseManifest('demo'), { 'a.md': '1' });
    const fresh = await installFrom(v1, deps);
    expect(fresh.upgradeFrom).toBeUndefined();
    await expect(installFrom(v1, deps)).rejects.toMatchObject({ code: 'PLUGIN_VERSION_EXISTS', message: 'This version exists. Choose replace explicitly.' });
    expect((await installFrom(v1, deps, { replace: true })).upgradeFrom).toBe('1.0.0');
    const v2 = await writePackage(path.join(root, 'v2'), baseManifest('demo', '2.0.0'));
    expect((await installFrom(v2, deps)).upgradeFrom).toBe('1.0.0');
    expect(await installedVersions(deps, 'demo')).toEqual(['2.0.0']);
    await expect(installFrom(v1, deps)).rejects.toMatchObject({ code: 'PLUGIN_DOWNGRADE' });
  });

  it('version append keeps old versions and refuses re-publishing one', async () => {
    const root = await tempRoot(); const deps = makeDeps(root, { versionAppend: true, repo: { listAll: async () => [{ pluginId: 'DEMO', enabled: true, version: '1.0.0' } as never] } });
    await installFrom(await writePackage(path.join(root, 'v1'), baseManifest('demo')), makeDeps(root));
    await installFrom(await writePackage(path.join(root, 'v2'), baseManifest('demo', '2.0.0')), deps);
    expect(await installedVersions(deps, 'demo')).toEqual(['1.0.0', '2.0.0']);
    await expect(installFrom(path.join(root, 'v2'), makeDeps(root, { versionAppend: true }))).rejects.toMatchObject({ code: 'PLUGIN_VERSION_EXISTS', message: 'Version append requires a new version; installed bytes are immutable.' });
    await expect(installFrom(path.join(root, 'v2'), deps, { replace: true })).rejects.toMatchObject({ code: 'PLUGIN_ENABLED' });
  });

  it('refuses an enabled plugin, Trash entries, case aliases and unsafe slots', async () => {
    const root = await tempRoot();
    const source = await writePackage(path.join(root, 'src'), baseManifest('demo'));
    const enabled = makeDeps(root, { repo: { listAll: async () => [{ pluginId: 'other', enabled: true }, { pluginId: 'Demo', enabled: false }, { pluginId: 'demo', enabled: true }] as never } });
    await expect(previewSitePluginInstall({ sourceDir: source, deps: enabled })).rejects.toMatchObject({ code: 'PLUGIN_ENABLED' });
    const deps = makeDeps(root);
    await mkdir(path.join(root, 'plugins-trash', 'demo'), { recursive: true });
    await expect(previewSitePluginInstall({ sourceDir: source, deps })).rejects.toMatchObject({ code: 'PLUGIN_IN_TRASH' });
    await rm(path.join(root, 'plugins-trash'), { recursive: true });
    await mkdir(path.join(deps.installDir, 'Demo'), { recursive: true });
    await expect(previewSitePluginInstall({ sourceDir: source, deps })).rejects.toMatchObject({ code: 'PLUGIN_ID_CONFLICT', message: 'A plugin id differs only by letter case.' });
    await rm(path.join(deps.installDir, 'Demo'), { recursive: true });
    // Pinned: a file at the slot surfaces the raw ENOTDIR from the version probe, not PLUGIN_PACKAGE_UNSAFE.
    await writeFile(path.join(deps.installDir, 'demo'), 'not a folder');
    await expect(previewSitePluginInstall({ sourceDir: source, deps })).rejects.toMatchObject({ code: 'ENOTDIR' });
    await rm(path.join(deps.installDir, 'demo'));
    // A linked slot hidden from the identity scan is still refused by the slot check.
    const hidden = { ...filesystem, readdir: (async () => []) as unknown as typeof filesystem.readdir };
    await mkdir(path.join(root, 'elsewhere', '1.0.0'), { recursive: true });
    await symlink(path.join(root, 'elsewhere'), path.join(deps.installDir, 'demo'));
    await expect(previewSitePluginInstall({ sourceDir: source, deps: makeDeps(root, { identityFilesystem: hidden }) })).rejects.toMatchObject({ code: 'PLUGIN_PACKAGE_UNSAFE' });
    await rm(path.join(deps.installDir, 'demo'));
    await mkdir(path.join(deps.installDir, 'demo', 'abc'), { recursive: true });
    await mkdir(path.join(deps.installDir, 'demo', '.meta'), { recursive: true });
    await expect(previewSitePluginInstall({ sourceDir: source, deps })).rejects.toMatchObject({ code: 'PLUGIN_ID_CONFLICT', message: 'Existing plugin has an unrecognized version folder.' });
    await rm(path.join(deps.installDir, 'demo', 'abc'), { recursive: true });
    expect((await previewSitePluginInstall({ sourceDir: source, deps })).upgradeFrom).toBeUndefined();
  });

  it('refuses linked neighbour slots, versions and manifests; skips non-folders', async () => {
    const root = await tempRoot(); const deps = makeDeps(root);
    const source = await writePackage(path.join(root, 'src'), baseManifest('demo'));
    await mkdir(deps.installDir, { recursive: true });
    await writeFile(path.join(deps.installDir, 'loose-file'), 'x');
    await mkdir(path.join(deps.installDir, 'other'), { recursive: true });
    await writeFile(path.join(deps.installDir, 'other', '1.0.0'), 'file version');
    await mkdir(path.join(deps.installDir, 'other', 'notes'));
    expect((await previewSitePluginInstall({ sourceDir: source, deps })).id).toBe('demo');
    await symlink(path.join(root, 'src'), path.join(deps.installDir, 'linked'));
    await expect(previewSitePluginInstall({ sourceDir: source, deps })).rejects.toMatchObject({ code: 'PLUGIN_PACKAGE_UNSAFE', message: 'Installed plugin directory must not be a link.' });
    await rm(path.join(deps.installDir, 'linked'));
    await symlink(path.join(root, 'src'), path.join(deps.installDir, 'other', '2.0.0'));
    await expect(previewSitePluginInstall({ sourceDir: source, deps })).rejects.toMatchObject({ code: 'PLUGIN_PACKAGE_UNSAFE', message: 'Installed plugin version must not be a link.' });
    await rm(path.join(deps.installDir, 'other', '2.0.0'));
    await mkdir(path.join(deps.installDir, 'other', '3.0.0', PLUGIN_MANIFEST_FILENAME), { recursive: true });
    await expect(previewSitePluginInstall({ sourceDir: source, deps })).rejects.toMatchObject({ code: 'PLUGIN_PACKAGE_UNSAFE', message: 'Installed plugin manifests must not be links.' });
  });

  it('reads a legacy-named neighbour manifest and detects its identity conflict', async () => {
    const root = await tempRoot(); const deps = makeDeps(root);
    await writePackage(path.join(deps.installDir, 'other', '1.0.0'), { ...baseManifest('other'), extensions: { tovu: { id: 'vendor/demo' } } }, {}, { filename: LEGACY_PLUGIN_MANIFEST_FILENAME });
    const source = await writePackage(path.join(root, 'src'), baseManifest('demo'));
    await expect(previewSitePluginInstall({ sourceDir: source, deps })).rejects.toMatchObject({ code: 'PLUGIN_ID_CONFLICT' });
  });

  it('propagates root and slot faults other than ENOENT/EACCES; defaults warn to console', async () => {
    const root = await tempRoot();
    const source = await writePackage(path.join(root, 'src'), baseManifest('demo'));
    const installDir = path.join(root, 'plugins');
    await mkdir(path.join(installDir, 'broken', '1.0.0'), { recursive: true });
    const faulty = (target: string, error: object) => ({ ...filesystem, readdir: (async (...args: Parameters<typeof filesystem.readdir>) => {
      if (String(args[0]) === target) throw Object.assign(new Error('fault'), error);
      return Reflect.apply(filesystem.readdir, filesystem, args);
    }) as typeof filesystem.readdir });
    await expect(previewSitePluginInstall({ sourceDir: source, deps: makeDeps(root, { identityFilesystem: faulty(installDir, { code: 'EIO' }) }) })).rejects.toMatchObject({ code: 'EIO' });
    await expect(previewSitePluginInstall({ sourceDir: source, deps: makeDeps(root, { identityFilesystem: faulty(path.join(installDir, 'broken'), { code: 'EIO' }) }) })).rejects.toMatchObject({ code: 'EIO' });
    await expect(previewSitePluginInstall({ sourceDir: source, deps: makeDeps(root, { identityFilesystem: faulty(path.join(installDir, 'broken'), {}) }) })).rejects.toThrow('fault');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await previewSitePluginInstall({ sourceDir: source, deps: withoutWarn(makeDeps(root, { identityFilesystem: faulty(path.join(installDir, 'broken'), { code: 'EACCES' }) })) });
    await previewSitePluginInstall({ sourceDir: source, deps: withoutWarn(makeDeps(root)) });
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      "Plugin 'broken': installed slot is unavailable; omitted from identity admission.",
      "Plugin 'broken': installed identity manifest is unreadable or invalid; omitted from identity admission.",
    ]);
  });

  it('isolates a manifest probe fault other than ENOENT as an unreadable manifest', async () => {
    const root = await tempRoot(); const warnings: string[] = [];
    const installDir = path.join(root, 'plugins');
    const probe = path.join(installDir, 'broken', '1.0.0', PLUGIN_MANIFEST_FILENAME);
    await mkdir(path.dirname(probe), { recursive: true });
    const identityFilesystem = { ...filesystem, lstat: (async (...args: Parameters<typeof filesystem.lstat>) => {
      if (String(args[0]) === probe) throw Object.assign(new Error('fault'), { code: 'EIO' });
      return Reflect.apply(filesystem.lstat, filesystem, args);
    }) as typeof filesystem.lstat };
    const source = await writePackage(path.join(root, 'src'), baseManifest('demo'));
    await previewSitePluginInstall({ sourceDir: source, deps: makeDeps(root, { identityFilesystem, warn: (message) => warnings.push(message) }) });
    expect(warnings).toEqual(["Plugin 'broken': installed identity manifest is unreadable or invalid; omitted from identity admission."]);
  });
});

describe('publication', () => {
  it('refuses a changed digest and non-folder roots', async () => {
    const root = await tempRoot(); const deps = makeDeps(root);
    const source = await writePackage(path.join(root, 'src'), baseManifest('demo'));
    await expect(installSitePlugin({ sourceDir: source, expectedDigest: 'stale', deps })).rejects.toMatchObject({ code: 'PLUGIN_CHANGED_SINCE_PREVIEW' });
    const preview = await previewSitePluginInstall({ sourceDir: source, deps });
    await writeFile(path.join(root, 'plugins-staging'), 'file');
    await expect(installSitePlugin({ sourceDir: source, expectedDigest: preview.digest, deps })).rejects.toMatchObject({ code: 'PLUGIN_PACKAGE_UNSAFE' });
    await rm(path.join(root, 'plugins-staging'));
    await mkdir(path.join(root, 'plugins-trash'));
    await installSitePlugin({ sourceDir: source, expectedDigest: preview.digest, deps });
    expect(await readdir(path.join(root, 'plugins-staging'))).toEqual([]);
  });

  it('rolls a failed replacement back and rethrows the publish error', async () => {
    const root = await tempRoot(); const deps = makeDeps(root);
    const source = await writePackage(path.join(root, 'src'), baseManifest('demo'), { 'a.md': 'old' });
    await installFrom(source, deps);
    const next = await writePackage(path.join(root, 'next'), baseManifest('demo'), { 'a.md': 'new' });
    renameFaults.push((from) => from.endsWith(path.join('new', '1.0.0')));
    await expect(installFrom(next, deps, { replace: true })).rejects.toThrow('rename fault');
    expect(await readFile(path.join(deps.installDir, 'demo', '1.0.0', 'a.md'), 'utf8')).toBe('old');
    expect(await readdir(path.join(root, 'plugins-staging'))).toEqual([]);
  });

  it('a failed new-version publish rethrows without a rollback', async () => {
    const root = await tempRoot(); const deps = makeDeps(root);
    await installFrom(await writePackage(path.join(root, 'v1'), baseManifest('demo')), deps);
    renameFaults.push((from) => from.endsWith(path.join('new', '2.0.0')));
    await expect(installFrom(await writePackage(path.join(root, 'v2'), baseManifest('demo', '2.0.0')), deps)).rejects.toThrow('rename fault');
    expect(await installedVersions(deps, 'demo')).toEqual(['1.0.0']);
  });

  it('keeps staging and asks for recovery when the rollback itself fails', async () => {
    const root = await tempRoot(); const deps = makeDeps(root);
    const source = await writePackage(path.join(root, 'src'), baseManifest('demo'));
    await installFrom(source, deps);
    renameFaults.push((from) => from.endsWith(path.join('new', '1.0.0')), (from) => path.basename(from) === 'old');
    await expect(installFrom(source, deps, { replace: true })).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_RECOVERY_REQUIRED' });
    const [staging] = await readdir(path.join(root, 'plugins-staging'));
    expect(await readdir(path.join(root, 'plugins-staging', staging!))).toContain('old');
  });
});

describe('pruneSitePluginVersions', () => {
  it('keeps the newest three plus every enabled version', async () => {
    const root = await tempRoot(); const installDir = path.join(root, 'plugins');
    for (const version of ['1.0.0', '2.0.0', '3.0.0', '4.0.0', '5.0.0', '.meta']) await mkdir(path.join(installDir, 'demo', version), { recursive: true });
    const repo = { listAll: async () => [{ pluginId: 'demo', enabled: true, version: '1.0.0' }, { pluginId: 'demo', enabled: false, version: '2.0.0' }, { pluginId: 'other', enabled: true, version: '2.0.0' }] as never };
    expect(await pruneSitePluginVersions({ id: 'demo', installDir, repo })).toEqual(['2.0.0']);
    expect((await readdir(path.join(installDir, 'demo'))).sort()).toEqual(['.meta', '1.0.0', '3.0.0', '4.0.0', '5.0.0']);
  });

  it('refuses invalid ids, linked folders and unrecognized versions', async () => {
    const root = await tempRoot(); const installDir = path.join(root, 'plugins'); const repo = { listAll: async () => [] };
    await expect(pruneSitePluginVersions({ id: '../x', installDir, repo })).rejects.toMatchObject({ code: 'PLUGIN_PACKAGE_UNSAFE' });
    await mkdir(path.join(installDir, 'demo', 'abc'), { recursive: true });
    await expect(pruneSitePluginVersions({ id: 'demo', installDir, repo })).rejects.toMatchObject({ code: 'PLUGIN_ID_CONFLICT' });
    await symlink(path.join(installDir, 'demo'), path.join(installDir, 'linked'));
    await expect(pruneSitePluginVersions({ id: 'linked', installDir, repo })).rejects.toMatchObject({ code: 'PLUGIN_PACKAGE_UNSAFE' });
  });
});
