/** Package-location decisions (built-in vs site layout, unsafe segments) and the integrity
 * authoring command, exercised against real temp folders. */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePackageLocation, SAFE_PLUGIN_ID_SEGMENT } from '../../node/runtime-package-location.js';
import { runPluginIntegrityCommand } from '../../node/integrity-command.js';
import { PluginPackagePathError } from '../../node/package-files.js';
import { createPluginRuntimeCore, type PluginRuntimeSource } from '../../node/index.js';
import type { PluginDiscoveryRecord } from '../../discovery-types.js';
import type { PluginManifest } from '../../manifest.js';
import { InMemoryPluginActivationRepo } from '../../repo.memory.js';
import { manifestHost, pluginSdkBinding } from '../support/fixture-bindings.js';
import { createPluginInvocationBinding } from '../../node/index.js';
import { withFileLock } from '@jini-ai/platform/fs/file-lock';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const manifest: PluginManifest = {
  id: 'word-tally', name: 'Word Tally', version: '1.0.0', sdkRange: '>=0.0.0', engine: 1, tier: 'tier-3',
  capabilities: ['content.read'], hooks: [], fields: [], integrity: {},
};
const record = (patch: Partial<PluginDiscoveryRecord> = {}): PluginDiscoveryRecord => ({
  id: 'word-tally', name: 'Word Tally', version: '1.0.0', source: 'site', status: 'valid', errors: [], ...patch,
});
const builtIn = (sourceDir?: string): PluginRuntimeSource => ({
  source: 'built-in', manifest, entryPath: 'tally:entry', importModule: async () => ({}), ...(sourceDir === undefined ? {} : { sourceDir }),
});

describe('resolvePackageLocation', () => {
  it('uses a built-in source folder as both root and container, matched by manifest id', () => {
    const sources = [{ ...builtIn('/other'), manifest: { ...manifest, id: 'other-plugin' } }, builtIn('/built/word-tally')];
    expect(resolvePackageLocation({ record: record({ source: 'built-in' }), sources, installDir: '/ignored' }))
      .toEqual({ rootDir: '/built/word-tally', containerDir: '/built/word-tally' });
  });

  it('returns null for a built-in without a source folder or without a matching source', () => {
    expect(resolvePackageLocation({ record: record({ source: 'built-in' }), sources: [builtIn()], installDir: '/x' })).toBeNull();
    expect(resolvePackageLocation({ record: record({ source: 'built-in', id: 'missing' }), sources: [builtIn('/b')], installDir: '/x' })).toBeNull();
  });

  it('returns null for a site record while no install folder is configured', () => {
    expect(resolvePackageLocation({ record: record(), sources: [], installDir: undefined })).toBeNull();
  });

  it('joins <installDir>/<id>/<version> for a safe site record, with the install folder as container', () => {
    expect(resolvePackageLocation({ record: record({ version: '1.2.0-rc.1+build' }), sources: [], installDir: '/site/plugins' }))
      .toEqual({ rootDir: path.join('/site/plugins', 'word-tally', '1.2.0-rc.1+build'), containerDir: '/site/plugins' });
  });

  it.each([
    ['../escape', '1.0.0'],
    ['Word-Tally', '1.0.0'],
    ['word-tally', '../1.0.0'],
    ['word-tally', '.hidden'],
    ['word-tally', '1/0'],
  ])('refuses unsafe id %j / version %j with a PluginPackagePathError naming both', (id, version) => {
    const run = () => resolvePackageLocation({ record: record({ id, version }), sources: [], installDir: '/site/plugins' });
    expect(run).toThrow(PluginPackagePathError);
    expect(run).toThrow(`plugin '${id}' version '${version}' is not a safe path segment`);
  });

  it('allows inner dots and dashes in an id but no leading, trailing or doubled separator', () => {
    expect(['word-count', 'a.b-c', 'x1'].every((id) => SAFE_PLUGIN_ID_SEGMENT.test(id))).toBe(true);
    expect(['-a', 'a-', 'a..b', 'a/b', '', 'A'].some((id) => SAFE_PLUGIN_ID_SEGMENT.test(id))).toBe(false);
  });
});

function runtimeFor(sources: PluginRuntimeSource[], optional: { installDir?: string }) {
  const hook = 'record.preCommit';
  return createPluginRuntimeCore({
    workspaceId: 'tally-ws', clock: { nowMs: () => 0 } as never,
    activationRepo: new InMemoryPluginActivationRepo({ initialRows: [] }), sources,
    pluginSourcePolicy: { localInstallEnabled: () => false, confirmEnable: () => false },
    tier2CallRunner: (async () => { throw new Error('no tier-2 here'); }) as never,
    pluginSdkBinding: { ...pluginSdkBinding, hookIds: [hook], beforeSaveHook: hook, hookSemantics: { [hook]: 'shared' } },
    hostBinding: {
      capabilityVocabulary: ['content.read'], declarativeContentTypes: manifestHost.declarativeContentTypes,
      coreOwnerName: 'Tally core', identityNamespace: 'tally', localInstallDisabledMessage: 'off',
      tierPolicy: { execution: 'in-process', allowLoad: () => true, siteErrors: () => [], checkInstall: () => {} },
      archiveReader: async () => { throw new Error('no archives'); }, verifyDigest: async () => 'sha256-x',
      createInvocationCoreDeps: ({ pluginId, declaredHooks }) => createPluginInvocationBinding({ pluginId, declaredHooks, beforeSaveHook: hook }, {}),
      fileLock: { withFileLock },
    },
    createModuleImporter: (() => async () => ({ exported: {} })) as never,
    text: { scaffoldEntry: 'export default {};\n', reloadApprovalRequired: () => 'approve', restoreFailedReason: 'restore failed' },
    quarantineTelemetry: ({ pluginId }: { pluginId: string }) => ({ event: { kind: 'q', pluginId }, options: {} }),
  }, optional);
}

describe('plugin runtime core package folders', () => {
  it('lists a built-in source folder through readPluginPackageFiles, and nothing when it has no folder', async () => {
    const sourceDir = await tempDir('tally-src-');
    await writeFile(path.join(sourceDir, 'plugin.mjs'), 'export default 1;\n');
    const withFolder = runtimeFor([builtIn(sourceDir)], {});
    const listed = await withFolder.readPluginPackageFiles(record({ source: 'built-in' }));
    expect(listed.truncated).toBe(false);
    expect(listed.files).toEqual([{ relativePath: 'plugin.mjs', sizeBytes: 18, content: 'export default 1;\n', omitted: null }]);
    await withFolder.dispose({}, {});

    const withoutFolder = runtimeFor([builtIn()], {});
    expect(await withoutFolder.readPluginPackageFiles(record({ source: 'built-in' }))).toEqual({ files: [], truncated: false });
    await withoutFolder.dispose({}, {});
  });

  it('refuses to locate removal folders when no install folder is configured', async () => {
    const runtime = runtimeFor([], {});
    await expect(runtime.locatePluginPackageDirs('word-tally')).rejects.toThrow(
      "locatePluginPackageDirs: no installDir configured for this composition root — cannot remove 'word-tally'",
    );
    await runtime.dispose({}, {});
  });

  it('names the live folder when it exists and rethrows a non-ENOENT stat failure', async () => {
    const root = await tempDir('tally-install-');
    const installDir = path.join(root, 'plugins');
    await mkdir(path.join(installDir, 'word-tally'), { recursive: true });
    const runtime = runtimeFor([], { installDir });
    expect(await runtime.locatePluginPackageDirs('word-tally')).toEqual({
      liveParent: installDir, liveNames: ['word-tally'], parkedDir: path.join(root, 'plugins-trash', 'word-tally'),
    });
    await runtime.dispose({}, {});

    // A regular file as the install folder makes lstat(<file>/<id>) fail with ENOTDIR, not ENOENT.
    const fileAsDir = path.join(root, 'not-a-folder');
    await writeFile(fileAsDir, 'x');
    const broken = runtimeFor([], { installDir: fileAsDir });
    await expect(broken.locatePluginPackageDirs('word-tally')).rejects.toMatchObject({ code: 'ENOTDIR' });
    await broken.dispose({}, {});
  });
});

const sha = (text: string) => `sha256-${createHash('sha256').update(text).digest('hex')}`;

describe('runPluginIntegrityCommand', () => {
  it('prints the integrity map (manifest excluded) to the injected output and leaves the folder untouched', async () => {
    const dir = await tempDir('tally-integrity-');
    await writeFile(path.join(dir, 'jini.plugin.json'), '{"id":"word-tally"}');
    await mkdir(path.join(dir, 'server'));
    await writeFile(path.join(dir, 'server', 'index.mjs'), 'export {};');
    const out: string[] = [];
    await runPluginIntegrityCommand({ dir }, { output: (message) => out.push(message) });
    const expected = { 'server/index.mjs': sha('export {};') };
    expect(out).toEqual([JSON.stringify(expected, null, 2) + '\n']);
    expect(await readFile(path.join(dir, 'jini.plugin.json'), 'utf8')).toBe('{"id":"word-tally"}');
  });

  it('with write, stores the map into the canonical manifest atomically and leaves no staging file', async () => {
    const dir = await tempDir('tally-integrity-');
    await writeFile(path.join(dir, 'jini.plugin.json'), JSON.stringify({ id: 'word-tally', integrity: { stale: 'x' } }));
    await writeFile(path.join(dir, 'a.txt'), 'A');
    const out: string[] = [];
    await runPluginIntegrityCommand({ dir, write: true }, { output: (message) => out.push(message) });
    const written = await readFile(path.join(dir, 'jini.plugin.json'), 'utf8');
    expect(written).toBe(JSON.stringify({ id: 'word-tally', integrity: { 'a.txt': sha('A') } }, null, 2) + '\n');
    expect((await readdir(dir)).sort()).toEqual(['a.txt', 'jini.plugin.json']);
    expect(out).toEqual([JSON.stringify({ 'a.txt': sha('A') }, null, 2) + '\n']);
  });

  it('with write and only a legacy manifest, reads the legacy file and writes the canonical manifest', async () => {
    const dir = await tempDir('tally-integrity-');
    await writeFile(path.join(dir, 'legacy.plugin.json'), JSON.stringify({ id: 'legacy-tally' }));
    await writeFile(path.join(dir, 'b.txt'), 'B');
    await runPluginIntegrityCommand({ dir, write: true }, { legacyManifestFilenames: ['legacy.plugin.json'], output: () => {} });
    expect(JSON.parse(await readFile(path.join(dir, 'jini.plugin.json'), 'utf8'))).toEqual({ id: 'legacy-tally', integrity: { 'b.txt': sha('B') } });
    expect(await readFile(path.join(dir, 'legacy.plugin.json'), 'utf8')).toBe(JSON.stringify({ id: 'legacy-tally' }));
  });

  it('with write and no manifest at all, fails on the canonical path and stages nothing', async () => {
    const dir = await tempDir('tally-integrity-');
    await writeFile(path.join(dir, 'c.txt'), 'C');
    await expect(runPluginIntegrityCommand({ dir, write: true }, { output: () => {} })).rejects.toMatchObject({
      code: 'ENOENT', path: path.join(dir, 'jini.plugin.json'),
    });
    expect(await readdir(dir)).toEqual(['c.txt']);
  });

  it('writes to process stdout when no output is injected', async () => {
    const dir = await tempDir('tally-integrity-');
    await writeFile(path.join(dir, 'd.txt'), 'D');
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await runPluginIntegrityCommand({ dir });
      expect(write).toHaveBeenCalledWith(JSON.stringify({ 'd.txt': sha('D') }, null, 2) + '\n');
    } finally { write.mockRestore(); }
  });
});
