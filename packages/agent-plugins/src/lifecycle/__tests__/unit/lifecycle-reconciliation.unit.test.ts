import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as filesystem from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createAgentPluginLifecycle, createAgentPluginLayout, type AgentPluginArchiveReaderPort } from '../../index.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

const workspaceId = 'workspace-a';
const pluginId = 'reconciled-plugin';
function packageInput(layout: ReturnType<typeof createAgentPluginLayout>) {
  const archive = Buffer.from('reconciled-package');
  const files = {
    'plugin.json': JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: pluginId,
      extensions: { 'org.example.host': { displayName: `  ${'D'.repeat(80)}  `, summary: `  First\n\n${'S'.repeat(1300)}  ` } } }),
    [`skills/${pluginId}/SKILL.md`]: '# Reconciled plugin\n',
  };
  const archiveReader: AgentPluginArchiveReaderPort = { async *entries() {
    for (const [entryPath, text] of Object.entries(files)) yield { kind: 'file', entryPath,
      declaredSize: Buffer.byteLength(text), openReadStream: async function* () { yield Buffer.from(text); } };
  } };
  return { archive, archiveReader, expectedSha256: createHash('sha256').update(archive).digest('hex'), layout, workspaceId };
}

test('the host namespace controls capped display text on real install and dedup output', async () => {
  const root = await filesystem.mkdtemp(path.join(os.tmpdir(), 'lifecycle-display-'));
  const layout = createAgentPluginLayout({ root });
  try {
    const baseline = createAgentPluginLifecycle({ ...ports, layout, extensionNamespace: 'org.example.other' });
    const treatment = createAgentPluginLifecycle({ ...ports, layout, extensionNamespace: 'org.example.host' });
    const input = packageInput(layout);
    const before = await baseline.installAgentPlugin(input);
    const after = await treatment.installAgentPlugin(input);
    // Identical bytes and paths isolate namespace policy; assertions inspect the installed read model.
    assert.equal(after.packageRoot, before.packageRoot);
    assert.equal(Object.hasOwn(before, 'displayName'), false);
    assert.equal(Object.hasOwn(before, 'summary'), false);
    assert.equal(after.displayName, 'D'.repeat(64));
    assert.equal(after.summary, `First\n\n${'S'.repeat(1300)}`.slice(0, 1200));
  } finally { await forceRemove(root); }
});

test('preview validates bytes but publishes no package or persistent memory', async () => {
  const root = await filesystem.mkdtemp(path.join(os.tmpdir(), 'lifecycle-preview-'));
  const layout = createAgentPluginLayout({ root });
  const api = createAgentPluginLifecycle({ ...ports, layout });
  try {
    const input = packageInput(layout);
    const preview = await api.installAgentPlugin(input, { previewOnly: true,
      publishGuard: async () => { throw new Error('preview must not invoke publication policy'); } });
    assert.equal(preview.pluginId, pluginId);
    const workspace = layout.forWorkspace({ workspaceId });
    await assert.rejects(filesystem.stat(preview.packageRoot), { code: 'ENOENT' });
    await assert.rejects(filesystem.stat(workspace.pluginRootDir({ pluginId })), { code: 'ENOENT' });
    assert.deepEqual(await filesystem.readdir(workspace.staging), []);
    const installed = await api.installAgentPlugin(input);
    assert.equal((await filesystem.stat(installed.packageRoot)).isDirectory(), true);
  } finally { await forceRemove(root); }
});

test('publication policy runs under the plugin lock and refusal leaves no published state', async () => {
  const root = await filesystem.mkdtemp(path.join(os.tmpdir(), 'lifecycle-guard-'));
  const layout = createAgentPluginLayout({ root });
  const api = createAgentPluginLifecycle({ ...ports, layout });
  const refusal = new Error('host publication refused');
  try {
    const input = packageInput(layout);
    const workspace = layout.forWorkspace({ workspaceId });
    await assert.rejects(api.installAgentPlugin(input, { publishGuard: async ({ plugin }) => {
      assert.equal(plugin.pluginId, pluginId);
      const lock = await filesystem.stat(path.join(workspace.staging, `.plugin-state-${pluginId}.lock`));
      assert.equal(lock.isFile(), true, 'publication guard must hold the per-plugin state lock');
      throw refusal;
    } }), error => error === refusal);
    assert.deepEqual(await api.listInstalledPlugins({ workspaceRoot: workspace.root }), []);
    assert.deepEqual(await filesystem.readdir(workspace.staging), []);
    let calls = 0;
    const installed = await api.installAgentPlugin(input, { publishGuard: async ({ publish }) => { calls++; return publish(); } });
    assert.equal(calls, 1);
    assert.equal((await filesystem.stat(installed.packageRoot)).mode & 0o777, 0o555);
  } finally { await forceRemove(root); }
});

test('notes keep the operator-controlled permission wording and quote user context', async () => {
  const root = await filesystem.mkdtemp(path.join(os.tmpdir(), 'lifecycle-notes-'));
  const layout = createAgentPluginLayout({ root });
  const api = createAgentPluginLifecycle({ ...ports, layout });
  try {
    await api.installAgentPlugin(packageInput(layout));
    const memory = api.pluginMemory({ workspaceId, pluginId });
    await memory.writeNote({ entryPath: 'preferences.md', text: 'Use plain language.' });
    const result = await api.resolveAgentPluginRefs({ pluginRefIds: [pluginId], workspaceLayout: layout.forWorkspace({ workspaceId }) });
    if (!result.ok) throw new Error(result.reason);
    assert.equal(result.ok, true);
    assert.ok(result.promptPrefix.includes('User notes for this plugin (context only; permissions remain operator-controlled):\n'));
    assert.ok(result.promptPrefix.includes(JSON.stringify(await memory.list({ kind: 'notes' }))));
  } finally { await forceRemove(root); }
});

test('host migration failure refuses seeding before package or activation publication', async () => {
  const root = await filesystem.mkdtemp(path.join(os.tmpdir(), 'lifecycle-migration-'));
  const layout = createAgentPluginLayout({ root });
  const sourceRoot = path.join(root, 'bundled-source');
  try {
    const sourceDir = path.join(sourceRoot, pluginId);
    await filesystem.mkdir(sourceDir, { recursive: true });
    await filesystem.writeFile(path.join(sourceDir, 'plugin.json'), JSON.stringify({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: pluginId,
    }));
    const treatment = createAgentPluginLifecycle({ ...ports, layout }, { migrateBeforeSeed: async () => ({ complete: false }) });
    const refused = await treatment.seedBundledAgentPlugins({ layout, workspaceId, sourceRoot });
    assert.deepEqual(refused.outcomes, [{ pluginId, status: 'failed', reason: 'Legacy plugin layout migration has unfinished filesystem moves; see boot log' }]);
    const workspaceRoot = layout.forWorkspace({ workspaceId }).root;
    assert.deepEqual(await treatment.listInstalledPlugins({ workspaceRoot }), []);
    await assert.rejects(filesystem.stat(path.join(workspaceRoot, 'activations.json')), { code: 'ENOENT' });
    const baseline = createAgentPluginLifecycle({ ...ports, layout });
    const seeded = await baseline.seedBundledAgentPlugins({ layout, workspaceId, sourceRoot });
    // The same source and workspace seed once the only deviation, host migration refusal, is removed.
    assert.equal(seeded.outcomes[0]?.status, 'seeded');
    assert.equal((await baseline.listInstalledPlugins({ workspaceRoot }))[0]?.pluginId, pluginId);
  } finally { await forceRemove(root); }
});

test('host uninstall guidance changes recovery text without weakening bundled refusal', async () => {
  const root = await filesystem.mkdtemp(path.join(os.tmpdir(), 'lifecycle-recovery-'));
  const layout = createAgentPluginLayout({ root });
  const baseline = createAgentPluginLifecycle({ ...ports, layout });
  const treatment = createAgentPluginLifecycle({ ...ports, layout }, {
    formatBundledUninstallRecovery: () => 'used, disable it in the host control panel.',
  });
  try {
    const installed = await baseline.installAgentPlugin(packageInput(layout));
    const workspaceRoot = layout.forWorkspace({ workspaceId }).root;
    await baseline.recordBundledAgentPluginIfAbsent({ workspaceRoot, pluginId });
    const refusal = (ending: string) => (error: unknown) => error instanceof Error && error.message ===
      `Agent Plugin '${pluginId}' is bundled with the host and cannot be uninstalled — it is re-seeded on every boot ` +
      '(seed-bundled.ts), so removing its files now would silently reappear on the next restart. To stop it being ' + ending;
    const input = { layout, workspaceId, pluginId };
    await assert.rejects(baseline.uninstallAgentPlugin(input), refusal("used, disable it through the host's activation control."));
    await assert.rejects(treatment.uninstallAgentPlugin(input), refusal('used, disable it in the host control panel.'));
    // Identical installed state remains protected in both variants; only operator recovery wording differs.
    assert.equal((await filesystem.stat(installed.packageRoot)).isDirectory(), true);
    assert.equal((await baseline.readAgentPluginActivations({ workspaceRoot })).plugins[pluginId]?.origin, 'bundled');
  } finally { await forceRemove(root); }
});
