import { expect, test } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAgentPluginLifecycle, createAgentPluginLayout, type AgentPluginArchiveReaderPort, type AgentPluginLifecyclePorts } from '../../index.js';
import { createAgentPluginUpdateStore, AgentPluginUpdateError } from '../../update-store.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

const workspaceId = 'workspace-a';
const pluginId = 'operator-plugin';
function archiveInput(layout: ReturnType<typeof createAgentPluginLayout>, version: string, extension: Record<string, unknown> = {}) {
  const files = { 'plugin.json': JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: pluginId, version,
    extensions: { 'org.example.host': extension } }), 'skills/operator-plugin/SKILL.md': `# Version ${version}\nGuidance for ${version}` };
  const archive = Buffer.from(JSON.stringify(files));
  const archiveReader: AgentPluginArchiveReaderPort = { async *entries() {
    for (const [entryPath, text] of Object.entries(files)) yield { kind: 'file', entryPath, openReadStream: async function* () { yield Buffer.from(text); } };
  } };
  return { archive, archiveReader, expectedSha256: createHash('sha256').update(archive).digest('hex'), layout, workspaceId };
}
async function fixture(run: (h: Awaited<ReturnType<typeof harness>>) => Promise<void>, options: Partial<AgentPluginLifecyclePorts> = {}) {
  const h = await harness(options);
  try { await run(h); } finally { await forceRemove(h.temp); }
}
async function harness(options: Partial<AgentPluginLifecyclePorts> = {}) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-update-'));
  const layout = createAgentPluginLayout({ root: path.join(temp, 'plugins') });
  const events: string[] = [];
  const context = { ...ports, layout, mcpProvisioning: { ...ports.mcpProvisioning,
    provision: async ({ installed }: { installed: { version?: string | undefined } }) => { events.push(`provision:${installed.version}`); },
    notifyRosterChanged: async () => { events.push('notify'); },
  }, ...options };
  const api = createAgentPluginLifecycle(context);
  const previous = await api.installAgentPlugin(archiveInput(layout, '1.0.0', { provides: ['cap:old'] }));
  await api.setAgentPluginActivation({ workspaceRoot: layout.forWorkspace({ workspaceId }).root, pluginId, enabled: true, actor: 'owner' });
  const settingsSnapshot = { definitions: [{ key: 'example' }], values: [{ value: 'before' }] };
  const input = { ...archiveInput(layout, '2.0.0'), pluginId, expectedOldDigest: previous.archiveDigest, actor: 'operator:alice',
    snapshotSettings: async () => settingsSnapshot };
  const store = createAgentPluginUpdateStore({ ports: context, workspaceId, pluginId });
  return { api, context, input, previous, settingsSnapshot, store, layout, temp, events, workspaceRoot: layout.forWorkspace({ workspaceId }).root };
}

test('enabled update keeps memory and a single live digest; boot collects frozen rollback and retains private audit/settings', async () => {
  await fixture(async h => {
    const memory = h.api.pluginMemory({ workspaceId, pluginId });
    await memory.writeNote({ entryPath: 'preferences.md', text: 'Keep these notes.' });
    const result = await h.api.updateAgentPlugin(h.input);
    expect(result.plugin.version).toBe('2.0.0'); expect(result.enabled).toBe(true);
    expect(h.events).toEqual(['provision:2.0.0', 'notify']);
    expect((await h.api.listInstalledPlugins({ workspaceRoot: h.workspaceRoot })).map(p => p.archiveDigest)).toEqual([result.plugin.archiveDigest]);
    expect(await fs.readFile(path.join(h.layout.forWorkspace({ workspaceId }).pluginMemoryDir({ pluginId, kind: 'notes' }), 'preferences.md'), 'utf8')).toContain('Keep these notes.');
    const journal = (await h.store.read({}))!;
    expect(journal).toMatchObject({ state: 'committed', actor: 'operator:alice', fromVersion: '1.0.0', toVersion: '2.0.0', result: 'updated', settingsSnapshot: h.settingsSnapshot });
    const rollbackRoot = h.store.rollbackRoot({ digest: h.previous.archiveDigest });
    expect(rollbackRoot).not.toContain('/sha256/'); expect((await fs.stat(rollbackRoot)).mode & 0o777).toBe(0o555);
    const refs = await h.api.resolveAgentPluginRefs({ pluginRefIds: [pluginId], workspaceLayout: h.layout.forWorkspace({ workspaceId }) });
    expect(refs.ok && refs.promptPrefix).toContain('Version 2.0.0');
    await h.api.reconcileAgentPluginUpdates({ workspaceId });
    await h.api.reconcileAgentPluginUpdates({ workspaceId });
    await expect(fs.stat(rollbackRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    const history = path.join(h.layout.forWorkspace({ workspaceId }).pluginRootDir({ pluginId }), 'update-history', `${journal.transactionId}.json`);
    expect(JSON.parse(await fs.readFile(history, 'utf8')).settingsSnapshot).toEqual(h.settingsSnapshot);
    expect((await fs.stat(history)).mode & 0o777).toBe(0o600);
    expect((await h.api.listInstalledPlugins({ workspaceRoot: h.workspaceRoot }))[0]?.version).toBe('2.0.0');
  });
});

test('rollback on MCP activation failure restores old guidance and activation, reprovisions and audits', async () => {
  const provisioned: string[] = [];
  await fixture(async h => {
    await expect(h.api.updateAgentPlugin(h.input)).rejects.toThrow('candidate activation failed');
    expect((await h.api.listInstalledPlugins({ workspaceRoot: h.workspaceRoot })).map(p => p.version)).toEqual(['1.0.0']);
    expect((await h.api.resolveAgentPluginActivation({ workspaceRoot: h.workspaceRoot, pluginId })).verdict).toBe('active');
    expect(provisioned).toEqual(['2.0.0', '1.0.0']);
    expect(await h.store.read({})).toBeUndefined();
    const historyDir = path.join(h.layout.forWorkspace({ workspaceId }).pluginRootDir({ pluginId }), 'update-history');
    const history = JSON.parse(await fs.readFile(path.join(historyDir, (await fs.readdir(historyDir))[0]!), 'utf8'));
    expect(history).toMatchObject({ result: 'rolled-back', actor: 'operator:alice', fromDigest: h.previous.archiveDigest, toDigest: h.input.expectedSha256 });
  }, { mcpProvisioning: { ...ports.mcpProvisioning, provision: async ({ installed }) => {
    provisioned.push(installed.version!); if (installed.version === '2.0.0') throw new Error('candidate activation failed');
  } } });
});

test('downgrade, changed digest, bundled provenance and mismatched id refuse without modifying state', async () => {
  await fixture(async h => {
    await expect(h.api.updateAgentPlugin({ ...h.input, expectedOldDigest: '0'.repeat(64) })).rejects.toMatchObject({ code: 'PLUGIN_CHANGED' });
    await expect(h.api.updateAgentPlugin({ ...h.input, pluginId: 'other' })).rejects.toMatchObject({ code: 'PLUGIN_ID_MISMATCH' });
    await expect(h.api.updateAgentPlugin({ ...h.input, ...archiveInput(h.layout, '0.9.0') })).rejects.toMatchObject({ code: 'PLUGIN_DOWNGRADE_REFUSED' });
    await expect(h.api.updateAgentPlugin({ ...h.input, ...archiveInput(h.layout, '2.0.0', { hostRange: '>=99' }) })).rejects.toMatchObject({ code: 'PLUGIN_HOST_INCOMPATIBLE' });
    await h.api.setAgentPluginActivation({ workspaceRoot: h.workspaceRoot, pluginId, enabled: true, actor: 'system:seed' }, { origin: 'bundled' });
    await expect(h.api.updateAgentPlugin(h.input)).rejects.toMatchObject({ code: 'PLUGIN_BUNDLED' });
    expect((await h.api.readAgentPluginActivations({ workspaceRoot: h.workspaceRoot })).plugins[pluginId]?.enabled).toBe(true);
    expect((await h.api.listInstalledPlugins({ workspaceRoot: h.workspaceRoot }))[0]?.archiveDigest).toBe(h.previous.archiveDigest);
    expect(await h.store.read({})).toBeUndefined();
  });
});

test('same bytes are a no-op, disabled updates remain off, and missing capabilities warn', async () => {
  await fixture(async h => {
    const same = await h.api.updateAgentPlugin({ ...h.input, ...archiveInput(h.layout, '1.0.0', { provides: ['cap:old'] }) });
    expect(same.alreadyInstalled).toBe(true); expect(h.events).toEqual([]);
    await h.api.setAgentPluginEnabled({ workspaceId, pluginId, enabled: false, actor: 'owner' });
    const result = await h.api.updateAgentPlugin({ ...h.input, ...archiveInput(h.layout, '2.0.0', { requires: ['missing'] }) });
    expect(result.enabled).toBe(false); expect(result.warnings).toEqual(['Needs missing']);
  });
});

test('snapshot failure happens before intent or activation mutation', async () => {
  await fixture(async h => {
    await expect(h.api.updateAgentPlugin({ ...h.input, snapshotSettings: async () => { throw new Error('snapshot unavailable'); } })).rejects.toThrow('snapshot unavailable');
    expect(await h.store.read({})).toBeUndefined();
    expect((await h.api.resolveAgentPluginActivation({ workspaceRoot: h.workspaceRoot, pluginId })).verdict).toBe('active');
  });
});

test('an incomplete rollback is retried at boot; a malformed journal refuses recovery', async () => {
  let failRestore = false;
  await fixture(async h => {
    const instrumented = { ...h.context, filesystem: { ...fs,
      rename: (async (from, to) => {
        if (failRestore && String(from).includes('/rollback/')) throw new Error('restore interrupted');
        return fs.rename(from, to);
      }) as typeof fs.rename,
    }, mcpProvisioning: { ...ports.mcpProvisioning, provision: async () => { failRestore = true; throw new Error('activate failed'); } } };
    const api = createAgentPluginLifecycle(instrumented);
    await expect(api.updateAgentPlugin(h.input)).rejects.toThrow('restore interrupted');
    expect((await h.store.read({}))?.state).toBe('published');
    await expect(api.updateAgentPlugin(h.input)).rejects.toMatchObject({ code: 'PLUGIN_CHANGED' });
    failRestore = false;
    await h.api.reconcileAgentPluginUpdates({ workspaceId });
    expect((await h.api.listInstalledPlugins({ workspaceRoot: h.workspaceRoot }))[0]?.version).toBe('1.0.0');
    const journalPath = path.join(h.layout.forWorkspace({ workspaceId }).pluginRootDir({ pluginId }), 'update-journal.json');
    for (const value of ['{', 'null', '{}']) {
      await fs.writeFile(journalPath, value);
      await expect(h.api.reconcileAgentPluginUpdates({ workspaceId })).rejects.toBeInstanceOf(AgentPluginUpdateError);
    }
  });
});
