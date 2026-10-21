import { afterEach, describe, expect, test } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgentPluginLayout } from '../../layout.js';
import { createNodeAgentPluginEffects } from '../../node.js';
import { createPersistentStateModule } from '../../persistent-state.js';
import { createPackagePathsModule } from '../../package-paths.js';
import { createCapabilityProjectionModule } from '../../capability-projection.js';
import { createTrustedPluginFilesModule } from '../../trusted-plugin-files.js';
import { createBundledDigestsModule, BUNDLED_DIGESTS_FILENAME } from '../../bundled-digests.js';
import { createBundledSourceArchiveModule } from '../../bundled-source-archive.js';
import type { FilesystemPort } from '../../ports.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

/** @file Refusal and fallback paths of the small lifecycle modules, each through its public factory. */

const temporaries: string[] = [];
afterEach(async () => { for (const dir of temporaries.splice(0)) await forceRemove(dir); });
async function tempDir(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lifecycle-edges-')));
  temporaries.push(dir);
  return dir;
}

describe('createAgentPluginLayout', () => {
  test('refuses a relative root', () => {
    expect(() => createAgentPluginLayout({ root: 'relative/root' })).toThrow('Agent plugin root must be absolute');
  });
  test('lower-cases workspace ids and refuses unsafe or over-long ones', () => {
    const layout = createAgentPluginLayout({ root: '/plugins' });
    expect(layout.forWorkspace({ workspaceId: 'Team-A' }).root).toBe('/plugins/ws/team-a');
    expect(() => layout.forWorkspace({ workspaceId: '../escape' })).toThrow("'../escape' is not a safe plugin/workspace id");
    expect(() => layout.forWorkspace({ workspaceId: 'a'.repeat(65) })).toThrow('is not a safe plugin/workspace id');
  });
  test('memory directories exist only for the learned and notes kinds', () => {
    const workspace = createAgentPluginLayout({ root: '/plugins' }).forWorkspace({ workspaceId: 'ws' });
    expect(workspace.pluginMemoryDir({ pluginId: 'acme', kind: 'notes' })).toBe('/plugins/ws/ws/acme/memory/notes');
    expect(() => workspace.pluginMemoryDir({ pluginId: 'acme', kind: 'cache' as 'notes' })).toThrow('Invalid memory kind');
  });
});

describe('createNodeAgentPluginEffects process.isAlive', () => {
  const { process: host } = createNodeAgentPluginEffects({});
  test('a non-positive or non-integer pid is never alive', () => {
    for (const pid of [0, -1, 1.5, Number.NaN]) expect(host.isAlive({ pid })).toBe(false);
  });
  test('the current process is alive and an exited child is not', async () => {
    expect(host.isAlive({ pid: process.pid })).toBe(true);
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['-e', '']);
    await new Promise(resolve => child.on('exit', resolve));
    expect(host.isAlive({ pid: child.pid! })).toBe(false);
  });
});

describe('createPersistentStateModule migration manifest policy', () => {
  test('a legacy package whose manifest the host parser refuses is quarantined, with no event port wired', async () => {
    const root = await tempDir();
    const legacy = path.join(root, 'packages', 'sha256', 'a'.repeat(64));
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, 'plugin.json'), JSON.stringify({ name: 'Not A Valid Name' }));
    const { onEvent: _omitted, ...withoutEvents } = ports;
    const result = await createPersistentStateModule(withoutEvents).migrate({ workspaceRoot: root });
    expect(result).toEqual({ complete: true, moved: 0 });
    const [run] = await fs.readdir(path.join(root, 'staging', 'legacy-quarantine'));
    expect(JSON.parse(await fs.readFile(path.join(root, 'staging', 'legacy-quarantine', run!, 'packages', 'sha256', 'a'.repeat(64), 'plugin.json'), 'utf8')))
      .toEqual({ name: 'Not A Valid Name' });
    await expect(fs.stat(legacy)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('createPackagePathsModule', () => {
  test('when no ancestor below the root can be realpathed, the lexical path is kept under the real root', async () => {
    let calls = 0;
    const filesystem = { ...fs, realpath: (async (target: string) => {
      if (calls++ === 0) return target;
      throw Object.assign(new Error('gone'), { code: 'ENOENT' });
    }) as FilesystemPort['realpath'] } as FilesystemPort;
    const { assertContainedOnDisk } = createPackagePathsModule({ filesystem });
    expect(await assertContainedOnDisk('/pkg', 'a/b/c.md')).toBe('/pkg/a/b/c.md');
  });
});

describe('createCapabilityProjectionModule', () => {
  const capabilities = createCapabilityProjectionModule(ports);
  test('a skill path outside the package returns the recoverable refusal note, not an error', async () => {
    const root = await tempDir();
    expect(await capabilities.readInstalledSkillFile({ packageRoot: root, skillPath: '../elsewhere/SKILL.md' })).toEqual({
      text: '', files: [], note: 'File request refused: the installed skill folder is missing, unreadable, or outside the package. Valid supporting files: (none).',
    });
  });
  test('MCP servers are still read when the package has no readable plugin.json', async () => {
    const root = await tempDir();
    await fs.writeFile(path.join(root, 'mcp.json'), JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: { main: { type: 'stdio', command: './server.js' } } }));
    expect(await capabilities.readInstalledMcpServerIds(root)).toEqual(['main']);
  });
});

describe('createTrustedPluginFilesModule importContainedModule', () => {
  test('returns a thrown Error message, or a thrown value as text, instead of rejecting', async () => {
    const root = await tempDir();
    await fs.writeFile(path.join(root, 'throws-error.mjs'), 'throw new Error("module refused to load");');
    await fs.writeFile(path.join(root, 'throws-value.mjs'), 'throw "plain refusal";');
    const { importContainedModule } = createTrustedPluginFilesModule(ports);
    const plugin = { pluginId: 'acme', packageRoot: root };
    expect(await importContainedModule(plugin, 'throws-error.mjs')).toBe('module refused to load');
    expect(await importContainedModule(plugin, 'throws-value.mjs')).toBe('plain refusal');
  });
  test('a filesystem fault during containment propagates rather than reading as a refusal', async () => {
    const filesystem = { ...fs, realpath: (async () => { throw Object.assign(new Error('EACCES: denied'), { code: 'EACCES' }); }) as FilesystemPort['realpath'] } as FilesystemPort;
    const { importContainedModule } = createTrustedPluginFilesModule({ ...ports, filesystem });
    await expect(importContainedModule({ pluginId: 'acme', packageRoot: '/pkg' }, 'module.mjs')).rejects.toMatchObject({ code: 'EACCES' });
  });
});

describe('createBundledDigestsModule ledger hygiene', () => {
  const digest = 'b'.repeat(64);
  test('normalization skips unsafe ids and non-object entries but keeps valid siblings', () => {
    const { normalizeBundledDigests } = createBundledDigestsModule(ports);
    const ledger = normalizeBundledDigests({ schemaVersion: 1, plugins: { 'Bad Id': { archiveDigest: digest }, scalar: 'x', good: { archiveDigest: digest } } });
    expect([...ledger]).toEqual([['good', digest]]);
  });
  test('recording ignores a seeded entry with a malformed digest', async () => {
    const root = await tempDir();
    const { recordBundledAgentPluginDigests, readBundledAgentPluginDigests } = createBundledDigestsModule(ports);
    await recordBundledAgentPluginDigests({ workspaceRoot: root, seeded: [{ pluginId: 'good', archiveDigest: digest }, { pluginId: 'bad', archiveDigest: 'not-hex' }] });
    expect([...await readBundledAgentPluginDigests(root)]).toEqual([['good', digest]]);
  });
  test('removing an id the ledger does not record reports false and leaves the file unchanged', async () => {
    const root = await tempDir();
    const { recordBundledAgentPluginDigests, removeBundledAgentPluginDigest } = createBundledDigestsModule(ports);
    await recordBundledAgentPluginDigests({ workspaceRoot: root, seeded: [{ pluginId: 'good', archiveDigest: digest }] });
    const before = await fs.readFile(path.join(root, BUNDLED_DIGESTS_FILENAME), 'utf8');
    expect(await removeBundledAgentPluginDigest({ workspaceRoot: root, pluginId: 'absent' })).toBe(false);
    expect(await fs.readFile(path.join(root, BUNDLED_DIGESTS_FILENAME), 'utf8')).toBe(before);
  });
  test('a failed atomic rename removes the temp file and keeps the previous ledger', async () => {
    const root = await tempDir();
    const writer = createBundledDigestsModule(ports);
    await writer.recordBundledAgentPluginDigests({ workspaceRoot: root, seeded: [{ pluginId: 'good', archiveDigest: digest }] });
    const filesystem = { ...fs, rename: (async () => { throw Object.assign(new Error('EXDEV: cross-device'), { code: 'EXDEV' }); }) as FilesystemPort['rename'] } as FilesystemPort;
    const failing = createBundledDigestsModule({ ...ports, filesystem });
    await expect(failing.removeBundledAgentPluginDigest({ workspaceRoot: root, pluginId: 'good' })).rejects.toMatchObject({ code: 'EXDEV' });
    expect(await fs.readdir(root)).toEqual([BUNDLED_DIGESTS_FILENAME]);
    expect([...await writer.readBundledAgentPluginDigests(root)]).toEqual([['good', digest]]);
  });
});

describe('createBundledSourceArchiveModule refusals', () => {
  const magic = ports.bundledArchiveMagic;
  async function readAll(bytes: Uint8Array): Promise<string[]> {
    const names: string[] = [];
    for await (const entry of createBundledSourceArchiveModule(ports).createBundledSourceArchiveReader().entries({ archive: bytes })) names.push(entry.entryPath);
    return names;
  }
  test('a directory with more files than the cap is refused before packing', async () => {
    const root = await tempDir();
    await Promise.all(Array.from({ length: 2049 }, (_, index) => fs.writeFile(path.join(root, `f${index}`), '')));
    await expect(createBundledSourceArchiveModule(ports).packAgentPluginDirectory(root)).rejects.toThrow(`has 2049 files, over the 2048-file cap`);
  });
  test('an entry header without a newline is truncated', async () => {
    await expect(readAll(Buffer.from(`${magic}F 1 1`))).rejects.toThrow('bundled agent plugin archive: truncated entry header');
  });
  test('an entry header in the wrong shape is malformed', async () => {
    await expect(readAll(Buffer.from(`${magic}X 1 1\n`))).rejects.toThrow("bundled agent plugin archive: malformed entry header 'X 1 1'");
  });
});
