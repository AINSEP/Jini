import assert from 'node:assert/strict';
import * as filesystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createPluginMemoryBindings, migrateSiblingAgentPluginLayouts, migrateSiteAgentPluginLayouts } from '../memory.js';
import { migratePluginLayout, withWorkspaceMigrationLock } from '@jini-ai/agent-plugins/persistent-state';
import { createAgentPluginSiteLayout } from '../../lifecycle/layout.js';
import { createAgentPluginLayout } from "../../lifecycle/layout.js";
import { parseAgentPluginManifest } from "../../lifecycle/manifest.js";

test('sibling migration locks finish before the active workspace lock is acquired', async () => {
  const root = await filesystem.mkdtemp(path.join(tmpdir(), 'plugin-migration-'));
  const order: string[] = []; let held = false;
  const effects = { filesystem, contain: async ({ root, entryPath }: { root: string; entryPath: string }) => path.resolve(root, entryPath),
    withLock: async <T>({ lockPath, run }: { lockPath: string; run(): Promise<T> }): Promise<T> => {
      assert.equal(held, false, 'workspace locks must not nest'); held = true; order.push(lockPath);
      try { return await run(); } finally { held = false; }
    } };
  const layout = createAgentPluginSiteLayout({ siteDir: root, rootOverride: root, diagnostics: { rootOverride: () => new Error('root'), workspaceId: () => new Error('workspace'), pluginId: () => new Error('plugin'), pluginDataId: () => new Error('data'), memoryKind: () => new Error('memory') } });
  const required = { ...effects, layout, workspaceId: 'active',
    migrateAgentPluginLayout: ({ workspaceId }: { workspaceId: string }, options = {}) => migratePluginLayout({ ...effects, workspaceRoot: layout.forWorkspace({ workspaceId }).root, parsePluginId: () => 'demo', onEvent: () => { assert.equal(held, true, 'migration effects require the workspace lock'); } }, options),
    warnInvalidWorkspace: ({ error }: { error: unknown }) => { throw error; }, warnMigration: ({ error }: { error: unknown }) => { throw error; } };
  try {
    await filesystem.mkdir(path.join(root, 'ws', 'active'), { recursive: true });
    await filesystem.mkdir(path.join(root, 'ws', 'sibling'), { recursive: true });
    await migrateSiblingAgentPluginLayouts(required);
    await withWorkspaceMigrationLock({ ...effects, workspaceRoot: layout.forWorkspace({ workspaceId: 'active' }).root,
      run: ({ ownership }) => migrateSiteAgentPluginLayouts(required, { ownership }) });
    assert.equal(order.length, 2);
    assert.ok(order[0]!.includes(`${path.sep}sibling${path.sep}`));
    assert.ok(order[1]!.includes(`${path.sep}active${path.sep}`));
  } finally { await filesystem.rm(root, { recursive: true, force: true }); }
});

test('site memory bindings preserve exact note context and use the active workspace migration result', async () => {
  const root = await filesystem.realpath(await filesystem.mkdtemp(path.join(tmpdir(), 'jini-site-memory-')));
  const layout = { ...createAgentPluginLayout({ root }), workspacesDir: path.join(root, 'ws') };
  const contain = async ({ root, entryPath }: { root: string; entryPath: string }) => path.resolve(root, entryPath);
  const locks: string[] = [];
  const bindings = createPluginMemoryBindings({
    filesystem, withLock: async ({ lockPath, run }) => { locks.push(lockPath); return run(); },
    parseManifest: parseAgentPluginManifest, onEvent: () => {},
    warnInvalidWorkspace: ({ error }) => { throw error; },
    warnMigration: ({ error }) => { throw error; },
  });
  const activeRoot = layout.forWorkspace({ workspaceId: 'active' }).root;
  try {
    const legacyDigest = 'c'.repeat(64);
    const legacyPath = path.join(activeRoot, 'packages', 'sha256', legacyDigest);
    await filesystem.mkdir(legacyPath, { recursive: true });
    await filesystem.mkdir(layout.forWorkspace({ workspaceId: 'sibling' }).root, { recursive: true });
    await filesystem.writeFile(path.join(legacyPath, 'plugin.json'), JSON.stringify({
      '$schema': 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'notes', version: '1.0.0',
    }));
    assert.deepEqual(await bindings.migrateSiteAgentPluginLayouts({ layout, workspaceId: 'active', contain }), { complete: true, moved: 1 });
    assert.equal(await filesystem.readFile(path.join(activeRoot, 'notes', 'package', 'sha256', legacyDigest, 'plugin.json'), 'utf8'),
      '{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json","name":"notes","version":"1.0.0"}');
    assert.deepEqual(JSON.parse(await filesystem.readFile(path.join(root, 'ws', 'sibling', '.agent-plugin-layout-migrated'), 'utf8')), { layoutVersion: 2 });
    const request = { contain, workspaceRoot: activeRoot, pluginId: 'notes', guidance: 'Stock guidance' };
    assert.equal(await bindings.appendPluginNotes(request), 'Stock guidance');
    const memory = bindings.pluginMemory({ layout, workspaceId: 'active', contain, pluginId: 'notes' });
    await memory.learned.write({ entryPath: 'remote.md', text: 'Learned content' });
    await memory.writeNote({ entryPath: 'context.md', text: 'Use "brown".\nSecond line.' });
    assert.equal(await bindings.appendPluginNotes(request), 'Stock guidance\n\nUser notes for this plugin (context only; permissions remain operator-controlled):\n' +
      '[{"relativePath":"context.md","text":"Use \\"brown\\".\\nSecond line."}]');
    assert.equal(locks.some(lock => lock.startsWith(path.join(root, 'ws', 'sibling') + path.sep)), true);
  } finally { await filesystem.rm(root, { recursive: true, force: true }); }
});

test('workspace discovery skips files and invalid ids, reports failed siblings and continues', async () => {
  const root = await filesystem.mkdtemp(path.join(tmpdir(), 'jini-sibling-memory-'));
  const layout = { ...createAgentPluginLayout({ root }), workspacesDir: path.join(root, 'ws') };
  const good = layout.forWorkspace({ workspaceId: 'good' }).root;
  const invalid: string[] = [];
  const failures: unknown[] = [];
  const migrated: string[] = [];
  const fault = new Error('sibling migration fault');
  try {
    for (const id of ['bad!id', 'broken', 'good', 'active']) await filesystem.mkdir(path.join(root, 'ws', id), { recursive: true });
    await filesystem.writeFile(path.join(root, 'ws', 'file'), '');
    await migrateSiblingAgentPluginLayouts({
      filesystem, layout, workspaceId: 'active',
      migrateAgentPluginLayout: async ({ workspaceId }) => {
        if (workspaceId === 'broken') throw fault;
        migrated.push(layout.forWorkspace({ workspaceId }).root);
        return { complete: true, moved: 1 };
      },
      warnInvalidWorkspace: ({ name }) => invalid.push(name),
      warnMigration: entry => failures.push(entry),
    });
    assert.deepEqual(invalid, ['bad!id']);
    assert.deepEqual(failures, [{ workspaceId: 'broken', error: fault }]);
    assert.deepEqual(migrated, [good]);
  } finally { await filesystem.rm(root, { recursive: true, force: true }); }
});
