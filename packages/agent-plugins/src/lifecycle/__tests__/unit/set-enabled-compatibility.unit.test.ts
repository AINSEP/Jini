import { expect, test } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  AgentPluginHostIncompatibleError, AgentPluginNotInstalledError, INVALID_AGENT_PLUGIN_HOST_RANGE,
  createAgentPluginLayout, createAgentPluginLifecycle, type AgentPluginArchiveReaderPort,
} from '../../index.js';
import { createPersistentStateModule } from '../../persistent-state.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

/** Real temp filesystem; archive bytes come from an injected reader port instead of a zip. */
const workspaceId = 'workspace-a';
const namespace = ports.extensionNamespace;
type Layout = ReturnType<typeof createAgentPluginLayout>;

function archiveInput(layout: Layout, pluginId: string, extension: Record<string, unknown>) {
  const files = {
    'plugin.json': JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: pluginId, version: '1.0.0',
      extensions: { [namespace]: extension } }),
    [`skills/${pluginId}/SKILL.md`]: `# ${pluginId}\nGuidance.`,
  };
  const archive = Buffer.from(JSON.stringify(files));
  const archiveReader: AgentPluginArchiveReaderPort = { async *entries() {
    for (const [entryPath, text] of Object.entries(files)) yield { kind: 'file', entryPath, openReadStream: async function* () { yield Buffer.from(text); } };
  } };
  return { archive, archiveReader, expectedSha256: createHash('sha256').update(archive).digest('hex'), layout, workspaceId };
}

async function withHarness(run: (h: { api: ReturnType<typeof createAgentPluginLifecycle>; layout: Layout; workspaceRoot: string;
  context: typeof ports; install: (pluginId: string, extension?: Record<string, unknown>) => Promise<void> }) => Promise<void>) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-set-enabled-'));
  try {
    const layout = createAgentPluginLayout({ root: path.join(temp, 'plugins') });
    const context = { ...ports, layout };
    const api = createAgentPluginLifecycle(context);
    const workspaceRoot = layout.forWorkspace({ workspaceId }).root;
    const install = async (pluginId: string, extension: Record<string, unknown> = {}) => { await api.installAgentPlugin(archiveInput(layout, pluginId, extension)); };
    await run({ api, layout, workspaceRoot, context, install });
  } finally { await forceRemove(temp); }
}

const toggle = (pluginId: string, enabled: boolean) => ({ workspaceId, pluginId, enabled, actor: 'operator:alice' });

test('installed index carries requires/hostRange from the host namespace, and omits them when absent', async () => {
  await withHarness(async ({ api, workspaceRoot, install }) => {
    await install('needs-cap', { requires: ['cap:x', 'cap:x'], hostRange: '^1' });
    await install('plain');
    const listed = await api.listInstalledPlugins({ workspaceRoot });
    const byId = Object.fromEntries(listed.map(plugin => [plugin.pluginId, plugin]));
    expect([byId['needs-cap']!.requires, byId['needs-cap']!.hostRange]).toEqual([['cap:x'], '^1']);
    expect('requires' in byId['plain']! || 'hostRange' in byId['plain']!).toBe(false);
  });
});

test('enabling a host-incompatible or malformed-range plugin is refused before any activation write', async () => {
  await withHarness(async ({ api, workspaceRoot, install }) => {
    await install('future', { hostRange: '>=99' });
    await install('garbled', { hostRange: 42 });
    for (const pluginId of ['future', 'garbled']) {
      const refusal = api.setAgentPluginEnabled(toggle(pluginId, true));
      await expect(refusal).rejects.toBeInstanceOf(AgentPluginHostIncompatibleError);
      await expect(refusal).rejects.toMatchObject({ code: 'PLUGIN_HOST_INCOMPATIBLE' });
    }
    expect((await api.listInstalledPlugins({ workspaceRoot })).find(p => p.pluginId === 'garbled')!.hostRange).toBe(INVALID_AGENT_PLUGIN_HOST_RANGE);
    const activations = await api.readAgentPluginActivations({ workspaceRoot });
    expect(Object.hasOwn(activations.plugins, 'future') || Object.hasOwn(activations.plugins, 'garbled')).toBe(false);
    // Disabling is never refused: an operator must always be able to turn an incompatible plugin off.
    expect(await api.setAgentPluginEnabled(toggle('future', false))).toEqual({ pluginId: 'future', enabled: false });
  });
});

test('enabling with unmet requirements succeeds and warns; disabled providers do not satisfy them', async () => {
  await withHarness(async ({ api, install }) => {
    await install('consumer', { requires: ['cap:a', 'cap:b'], hostRange: '^1' });
    await install('provider-a', { provides: ['cap:a'] });
    await install('provider-b', { provides: ['cap:b'] });
    await api.setAgentPluginEnabled(toggle('provider-b', false));
    expect(await api.setAgentPluginEnabled(toggle('consumer', true))).toEqual({ pluginId: 'consumer', enabled: true, warnings: ['Needs cap:b'] });
    expect(await api.setAgentPluginEnabled(toggle('provider-b', true))).toEqual({ pluginId: 'provider-b', enabled: true });
    expect(await api.setAgentPluginEnabled(toggle('consumer', true))).toEqual({ pluginId: 'consumer', enabled: true });
  });
});

test('disabling a provider an active plugin needs succeeds and names the dependent', async () => {
  await withHarness(async ({ api, install }) => {
    await install('consumer', { requires: ['cap:a'] });
    await install('provider-a', { provides: ['cap:a'] });
    expect(await api.setAgentPluginEnabled(toggle('provider-a', false)))
      .toEqual({ pluginId: 'provider-a', enabled: false, warnings: ['consumer needs cap:a'] });
    await api.setAgentPluginEnabled(toggle('consumer', false));
    await api.setAgentPluginEnabled(toggle('provider-a', true));
    expect(await api.setAgentPluginEnabled(toggle('provider-a', false))).toEqual({ pluginId: 'provider-a', enabled: false });
  });
});

test('an unknown or ungrammatical id is a not-installed refusal that creates no workspace or lock files', async () => {
  await withHarness(async ({ api, workspaceRoot }) => {
    for (const pluginId of ['missing', 'Not_A_Valid_Id', 'staging']) {
      await expect(api.setAgentPluginEnabled(toggle(pluginId, true))).rejects.toBeInstanceOf(AgentPluginNotInstalledError);
    }
    await expect(fs.stat(workspaceRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

test('a toggle waits for the per-plugin state lock and re-checks installation once it holds it', async () => {
  await withHarness(async ({ api, workspaceRoot, context, install }) => {
    await install('held');
    let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const holding = new Promise<void>(resolve => { entered = resolve; });
    const holder = createPersistentStateModule(context).withPluginLock({ workspaceRoot, pluginId: 'held', run: async () => {
      entered();
      await released;
      // Simulates an uninstall finishing while the toggle waited for the lock.
      const [plugin] = await api.listInstalledPlugins({ workspaceRoot });
      await forceRemove(plugin!.packageRoot);
    } });
    await holding;
    let settled = false;
    const toggled = api.setAgentPluginEnabled(toggle('held', true)).finally(() => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(settled).toBe(false);
    release();
    await holder;
    await expect(toggled).rejects.toBeInstanceOf(AgentPluginNotInstalledError);
    const activations = await api.readAgentPluginActivations({ workspaceRoot });
    expect(Object.hasOwn(activations.plugins, 'held')).toBe(false);
  });
});

test('with two installed digests of one id, enable is refused when ANY revision is host-incompatible', async () => {
  await withHarness(async ({ api, layout, workspaceRoot, install }) => {
    await install('twin', { hostRange: '^1' });
    const packagesDir = layout.forWorkspace({ workspaceId }).pluginPackagesDir({ pluginId: 'twin' });
    const [digest] = await fs.readdir(packagesDir);
    const stale = path.join(packagesDir, 'f'.repeat(64));
    await fs.cp(path.join(packagesDir, digest!), stale, { recursive: true });
    await fs.chmod(stale, 0o700);
    await fs.chmod(path.join(stale, 'plugin.json'), 0o600);
    const raw = JSON.parse(await fs.readFile(path.join(stale, 'plugin.json'), 'utf8'));
    raw.extensions[namespace].hostRange = '>=99';
    await fs.writeFile(path.join(stale, 'plugin.json'), JSON.stringify(raw));
    expect((await api.listInstalledPlugins({ workspaceRoot })).filter(plugin => plugin.pluginId === 'twin')).toHaveLength(2);
    await expect(api.setAgentPluginEnabled(toggle('twin', true))).rejects.toBeInstanceOf(AgentPluginHostIncompatibleError);
  });
});
