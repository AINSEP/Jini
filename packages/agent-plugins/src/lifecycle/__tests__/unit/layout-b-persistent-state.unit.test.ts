import { test, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createAgentPluginLayout } from '../../layout.js';
import { createInstallModule, type AgentPluginArchiveReaderPort } from '../../install.js';
import { createResolveAgentPluginRefsModule } from '../../resolve-agent-plugin-refs.js';
import { createPersistentStateModule } from '../../persistent-state.js';
import { createUninstallModule } from '../../uninstall.js';
import { ports as defaultPorts, assertContainedOnDisk, withFileLock } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';
import { migratePluginLayout } from '../../../../persistent-state.js';

test('neutral lifecycle uses Layout B, never refreezes a deduplicated install, and preserves notes/data through update', async () => {
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'jini-layout-b-')));
  const layout = createAgentPluginLayout({ root: temporary });
  const workspaceId = 'workspace-local';
  const workspace = layout.forWorkspace({ workspaceId });
  let freezeWrites = 0;
  const ports = { ...defaultPorts, layout, filesystem: { ...fs, chmod: (async (filename, mode) => {
    if (String(filename).includes('/package/sha256/')) freezeWrites++;
    return fs.chmod(filename, mode);
  }) as typeof fs.chmod } };
  const { installAgentPlugin } = createInstallModule(ports);
  const install = async (version: string) => {
    const archive = Buffer.from(version);
    const archiveReader: AgentPluginArchiveReaderPort = { async *entries() {
      for (const [entryPath, text] of [['plugin.json', JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'example', version })], ['skills/example/SKILL.md', '# Example\nGuidance']]) {
        yield { kind: 'file', entryPath: entryPath!, async *openReadStream() { yield Buffer.from(text!); } };
      }
    } };
    return installAgentPlugin({ layout, workspaceId, archive, archiveReader, expectedSha256: createHash('sha256').update(archive).digest('hex') });
  };
  try {
    const first = await install('1.0.0');
    expect(first.packageRoot).toBe(path.join(workspace.root, 'example', 'package', 'sha256', first.archiveDigest));
    const firstFreezeWrites = freezeWrites;
    expect(firstFreezeWrites).toBeGreaterThan(0);
    expect(await install('1.0.0')).toEqual(first);
    expect(freezeWrites).toBe(firstFreezeWrites);
    const memory = createPersistentStateModule(ports).memory({ workspaceRoot: workspace.root, pluginId: 'example' });
    await memory.writeNote({ entryPath: 'project.md', text: 'USER-CONTEXT' });
    await memory.learned.write({ entryPath: 'account.json', text: 'LEARNED-CACHE' });
    await fs.writeFile(path.join(workspace.pluginDataDir({ pluginId: 'example' }), 'cache'), 'STATE');
    await install('2.0.0');
    expect(await memory.read({ kind: 'notes', entryPath: 'project.md' })).toBe('USER-CONTEXT');
    expect(await memory.learned.read({ entryPath: 'account.json' })).toBe('LEARNED-CACHE');
    expect(await fs.readFile(path.join(workspace.pluginDataDir({ pluginId: 'example' }), 'cache'), 'utf8')).toBe('STATE');
    const refs = createResolveAgentPluginRefsModule(ports);
    expect(await refs.listInstalledPlugins(workspace.root)).toHaveLength(2);
    const uninstall = createUninstallModule(ports);
    const request = { layout, workspaceId, pluginId: 'example' };
    await uninstall.uninstallAgentPlugin(request);
    expect(await refs.listInstalledPlugins(workspace.root)).toEqual([]);
    expect(await memory.read({ kind: 'notes', entryPath: 'project.md' })).toBe('USER-CONTEXT');
    await install('2.0.0');
    const resolved = await refs.resolveAgentPluginRefs(['example'], workspace, 'inject');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) { expect(resolved.promptPrefix).toContain('USER-CONTEXT'); expect(resolved.promptPrefix).not.toContain('LEARNED-CACHE'); }
    const preview = await uninstall.previewAgentPluginUninstall(request);
    await uninstall.uninstallAgentPlugin(request, { confirmedPreview: preview, deleteMemory: true });
    await expect(fs.stat(workspace.pluginRootDir({ pluginId: 'example' }))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await forceRemove(temporary); }
});

test('migration quarantines refused legacy entries without losing bytes and marks the layout complete once', async () => {
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'jini-quarantine-')));
  const events: { event: string; message: string }[] = [];
  const state = createPersistentStateModule({ ...defaultPorts, onEvent: event => events.push(event) });
  const malformed = `packages/sha256/${'a'.repeat(64)}`;
  const fileDigest = `packages/sha256/${'b'.repeat(64)}`;
  const refused = ['packages/sha256/not-a-digest', 'packages/sha256/..\\stray', fileDigest, `${malformed}/plugin.json`, 'memory/example', 'data/example', 'data/UPPER/cache'];
  try {
    for (const relative of refused) {
      await fs.mkdir(path.dirname(path.join(temporary, relative)), { recursive: true });
      await fs.writeFile(path.join(temporary, relative), `saved:${relative}`);
    }
    await fs.chmod(path.join(temporary, malformed), 0o555);
    expect(await state.migrate({ workspaceRoot: temporary })).toEqual({ complete: true, moved: 0 });
    expect(JSON.parse(await fs.readFile(path.join(temporary, '.agent-plugin-layout-migrated'), 'utf8'))).toEqual({ layoutVersion: 2 });
    const quarantine = path.join(temporary, 'staging', 'legacy-quarantine');
    const runs = await fs.readdir(quarantine);
    expect(runs).toHaveLength(1);
    for (const relative of refused) {
      expect(await fs.readFile(path.join(quarantine, runs[0]!, relative), 'utf8')).toBe(`saved:${relative}`);
      await expect(fs.stat(path.join(temporary, relative))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect((await fs.stat(path.join(quarantine, runs[0]!, malformed))).mode & 0o777).toBe(0o555);
    const quarantined = events.filter(event => event.event === 'migration-quarantined');
    expect(quarantined).toHaveLength(7);
    expect(quarantined.every(event => event.message.includes(quarantine))).toBe(true);
    expect(events.some(event => event.event === 'migration-failed')).toBe(false);
    events.length = 0;
    expect(await state.migrate({ workspaceRoot: temporary })).toEqual({ complete: true, moved: 0 });
    expect(events).toEqual([]);
    expect(await fs.readdir(quarantine)).toEqual(runs);
  } finally { await forceRemove(temporary); }
});

test('Layout B wins package and mutable-state conflicts while every legacy copy survives in quarantine', async () => {
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'jini-quarantine-conflict-')));
  const digest = 'c'.repeat(64);
  const pairs = [
    [`packages/sha256/${digest}`, `example/package/sha256/${digest}`],
    ['memory/example', 'example/memory'], ['data/example', 'example/data'],
  ];
  try {
    for (const [legacy, current] of pairs) {
      for (const [relative, copy] of [[legacy!, 'legacy'], [current!, 'current']]) {
        await fs.mkdir(path.join(temporary, relative!), { recursive: true });
        await fs.writeFile(path.join(temporary, relative!, 'saved'), copy!);
      }
    }
    await fs.writeFile(path.join(temporary, pairs[0]![0]!, 'plugin.json'), JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'example' }));
    const events: string[] = [];
    const state = createPersistentStateModule({ ...defaultPorts, onEvent: ({ event }) => events.push(event) });
    expect(await state.migrate({ workspaceRoot: temporary })).toEqual({ complete: true, moved: 0 });
    const quarantine = path.join(temporary, 'staging', 'legacy-quarantine');
    const [run] = await fs.readdir(quarantine);
    for (const [legacy, current] of pairs) {
      expect(await fs.readFile(path.join(temporary, current!, 'saved'), 'utf8')).toBe('current');
      expect(await fs.readFile(path.join(quarantine, run!, legacy!, 'saved'), 'utf8')).toBe('legacy');
      await expect(fs.stat(path.join(temporary, legacy!))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect(events.filter(event => event === 'migration-quarantined')).toHaveLength(3);
    expect(await state.migrate({ workspaceRoot: temporary })).toEqual({ complete: true, moved: 0 });
  } finally { await forceRemove(temporary); }
});

test.each(['move', 'quarantine'])('a genuine migration %s failure preserves the source and refuses the completion marker', async kind => {
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'jini-move-failure-')));
  const legacy = path.join(temporary, 'packages', 'sha256', 'd'.repeat(64));
  try {
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, 'plugin.json'), kind === 'quarantine' ? 'bad json' : JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'example' }));
    const events: string[] = [];
    const state = createPersistentStateModule({ ...defaultPorts, filesystem: { ...fs,
      rename: (async (from, to) => {
        if (String(from) === legacy) throw new Error('move still in flight');
        return fs.rename(from, to);
      }) as typeof fs.rename,
    }, onEvent: ({ event }) => events.push(event) });
    expect((await state.migrate({ workspaceRoot: temporary })).complete).toBe(false);
    expect((await fs.stat(legacy)).isDirectory()).toBe(true);
    await expect(fs.stat(path.join(temporary, '.agent-plugin-layout-migrated'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(events).toContain('migration-failed');
    expect(events).not.toContain('migration-quarantined');
  } finally { await forceRemove(temporary); }
});

test.each(['migration', 'plugin'])('a held %s lock prevents migration completion without quarantining a valid source', async held => {
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'jini-migration-lock-')));
  const legacy = path.join(temporary, 'packages', 'sha256', 'e'.repeat(64));
  try {
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, 'plugin.json'), '{"name":"example"}');
    const request = { filesystem: fs, workspaceRoot: temporary,
      contain: ({ root, entryPath }: { root: string; entryPath: string }) => assertContainedOnDisk(root, entryPath),
      parsePluginId: ({ value }: { value: unknown }) => (value as { name: string }).name,
      // Simulate the lock port's refusal, keeping the real migration and filesystem operations.
      withLock: <T>({ lockPath, run }: { lockPath: string; run(): Promise<T> }): Promise<T> => {
        if (held === 'migration' || lockPath.includes('.plugin-state-')) return Promise.reject(new Error('lock held'));
        return withFileLock({ lockPath, run }, { staleMs: Infinity, createParent: true });
      },
    };
    if (held === 'migration') await expect(migratePluginLayout(request)).rejects.toThrow('lock held');
    else expect((await migratePluginLayout(request)).complete).toBe(false);
    expect((await fs.stat(legacy)).isDirectory()).toBe(true);
    await expect(fs.stat(path.join(temporary, '.agent-plugin-layout-migrated'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(temporary, 'staging', 'legacy-quarantine'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await forceRemove(temporary); }
});
