import assert from 'node:assert/strict';
import * as filesystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { migrateSiblingAgentPluginLayouts, migrateSiteAgentPluginLayouts } from '../memory.js';
import { migratePluginLayout, withWorkspaceMigrationLock } from '@jini-ai/agent-plugins/persistent-state';
import { createAgentPluginSiteLayout } from '../../lifecycle/layout.js';

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
