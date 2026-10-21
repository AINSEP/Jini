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

/** Crash-point harness: snapshot the workspace after every durable effect (rename, chmod, rm and
 * MCP provisioning) while `capture` is on, then replay each snapshot as a fresh process. */
async function crashHarness(prefix: string, { failCandidateMcp = false } = {}) {
  const temp = await filesystem.mkdtemp(path.join(os.tmpdir(), prefix));
  const layout = createAgentPluginLayout({ root: path.join(temp, 'original') });
  const workspace = layout.forWorkspace({ workspaceId });
  const snapshots: string[] = [];
  const control = { capture: false };
  const checkpoint = async () => {
    if (!control.capture) return;
    const directory = path.join(temp, `checkpoint-${snapshots.length}`);
    await filesystem.cp(workspace.root, directory, { recursive: true, preserveTimestamps: true });
    snapshots.push(directory);
  };
  const effects = { ...filesystem,
    rename: (async (from, to) => { await filesystem.rename(from, to); await checkpoint(); }) as typeof filesystem.rename,
    chmod: (async (file, mode) => { await filesystem.chmod(file, mode); await checkpoint(); }) as typeof filesystem.chmod,
    rm: (async (target, options) => { await filesystem.rm(target, options); await checkpoint(); }) as typeof filesystem.rm,
  };
  const mcpProvisioning = { ...ports.mcpProvisioning, provision: async ({ installed }: { installed: { version?: string | undefined } }) => {
    await checkpoint();
    if (failCandidateMcp && installed.version === '2.0.0') throw new Error('candidate MCP failed');
  } };
  const api = createAgentPluginLifecycle({ ...ports, layout, filesystem: effects, mcpProvisioning });
  const input = (version: string) => {
    const archive = Buffer.from(`crash-boundary-${version}`);
    const archiveReader: AgentPluginArchiveReaderPort = { async *entries() {
      yield { kind: 'file', entryPath: 'plugin.json', openReadStream: async function* () { yield Buffer.from(JSON.stringify({
        $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: pluginId, version,
      })); } };
    } };
    return { archive, expectedSha256: createHash('sha256').update(archive).digest('hex'), archiveReader, layout, workspaceId };
  };
  const previous = await api.installAgentPlugin(input('1.0.0'));
  await api.setAgentPluginActivation({ workspaceRoot: workspace.root, pluginId, enabled: true, actor: 'owner' });
  const update = () => api.updateAgentPlugin({ ...input('2.0.0'), pluginId, expectedOldDigest: previous.archiveDigest, actor: 'owner', snapshotSettings: async () => ({ values: [] }) });
  return { temp, api, snapshots, control, update };
}

/** The durable stage a snapshot reached: the active journal's state, or `filed` once the
 * committed audit is in the history and the journal is gone. */
async function durableStage(snapshot: string): Promise<string> {
  try { return JSON.parse(await filesystem.readFile(path.join(snapshot, pluginId, 'update-journal.json'), 'utf8')).state; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let filed: string[] = [];
  try { filed = await filesystem.readdir(path.join(snapshot, pluginId, 'update-history')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const name of filed) {
    if (JSON.parse(await filesystem.readFile(path.join(snapshot, pluginId, 'update-history', name), 'utf8')).result === 'updated') return 'filed';
  }
  return 'before-intent';
}

/** Boots a fresh process on each snapshot and asserts one enabled revision of the expected version,
 * no retained rollback bytes, and an idempotent second boot. Returns the stages seen. */
async function replayEverySnapshot({ temp, snapshots, expectedVersion }: { temp: string; snapshots: readonly string[]; expectedVersion: (stage: string) => string }) {
  const stages = new Set<string>();
  for (const [index, snapshot] of snapshots.entries()) {
    const replayLayout = createAgentPluginLayout({ root: path.join(temp, `replay-${index}`) });
    const replayWorkspace = replayLayout.forWorkspace({ workspaceId });
    await filesystem.mkdir(path.dirname(replayWorkspace.root), { recursive: true });
    await filesystem.cp(snapshot, replayWorkspace.root, { recursive: true });
    // The captured process is gone. Discard its lock files, not its recovery journal or bytes.
    for (const name of await filesystem.readdir(replayWorkspace.root)) {
      if (name.endsWith('.lock')) await filesystem.rm(path.join(replayWorkspace.root, name), { force: true });
    }
    await forceRemove(replayWorkspace.staging);
    const stage = await durableStage(snapshot);
    stages.add(stage);
    const replay = createAgentPluginLifecycle({ ...ports, layout: replayLayout });
    await replay.reconcileAgentPluginUpdates({ workspaceId });
    const installed = await replay.listInstalledPlugins({ workspaceRoot: replayWorkspace.root });
    assert.deepEqual(installed.map(plugin => plugin.version), [expectedVersion(stage)], `snapshot ${index} (${stage})`);
    assert.equal((await replay.resolveAgentPluginActivation({ workspaceRoot: replayWorkspace.root, pluginId })).verdict, 'active');
    assert.deepEqual(await filesystem.readdir(path.join(replayWorkspace.root, pluginId, 'rollback')).catch(() => []), []);
    await replay.reconcileAgentPluginUpdates({ workspaceId });
    assert.equal((await replay.listInstalledPlugins({ workspaceRoot: replayWorkspace.root })).length, 1);
  }
  return stages;
}

test('every durable update switch boundary recovers to one enabled revision after process death', async () => {
  const h = await crashHarness('update-crash-boundaries-');
  try {
    h.control.capture = true;
    await h.update();
    h.control.capture = false;
    assert.ok(h.snapshots.length > 10, 'capture stage, publish, freeze, journal switch, activation and MCP boundaries');
    const committed = (stage: string) => stage === 'committed' || stage === 'filed';
    const stages = await replayEverySnapshot({ ...h, expectedVersion: stage => committed(stage) ? '2.0.0' : '1.0.0' });
    for (const stage of ['before-intent', 'pending', 'published', 'committed', 'filed']) assert.ok(stages.has(stage), stage);
  } finally { await forceRemove(h.temp); }
});

test('a process death at any point of an in-process rollback still boots into the old revision', async () => {
  const h = await crashHarness('update-crash-rollback-', { failCandidateMcp: true });
  try {
    h.control.capture = true;
    await assert.rejects(h.update(), /candidate MCP failed/);
    h.control.capture = false;
    const stages = await replayEverySnapshot({ ...h, expectedVersion: () => '1.0.0' });
    for (const stage of ['pending', 'published']) assert.ok(stages.has(stage), stage);
  } finally { await forceRemove(h.temp); }
});

test('a process death while boot collects retained rollback bytes is finished by the next boot', async () => {
  const h = await crashHarness('update-crash-cleanup-');
  try {
    await h.update();
    h.control.capture = true;
    await h.api.reconcileAgentPluginUpdates({ workspaceId });
    h.control.capture = false;
    assert.ok(h.snapshots.length > 1, 'capture the unfreeze and removal of the rollback tree');
    const stages = await replayEverySnapshot({ ...h, expectedVersion: () => '2.0.0' });
    assert.deepEqual([...stages], ['filed']);
  } finally { await forceRemove(h.temp); }
});
