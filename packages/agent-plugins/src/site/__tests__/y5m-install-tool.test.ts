import { expect, it, vi } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { AgentPluginUpdateError } from '../../core/update-error.js';
import { FolderZipError } from '../../core/folder-zip-error.js';
import { bindAgentPluginsInstallTools } from '../install-tool.js';
import { createAgentPluginLayout } from '../../lifecycle/layout.js';
import type { AgentPluginLayout } from '@jini-ai/core/contracts/headless/plugin-host';

it('authorizes before source access and previews then publishes using the preview digest', async () => {
  const order: string[] = [];
  const archive = new Uint8Array([1]);
  const installUploadedAgentPlugin = vi.fn(async (input: { expectedSha256: string }) => { order.push('install'); expect(input.expectedSha256).toBe('preview-digest'); return { plugin: { pluginId: 'sample' }, alreadyInstalled: false }; });
  const bound = bindAgentPluginsInstallTools({
    catalog: ['agent_plugins_install', 'agent_plugins_update', 'agent_plugins_customize'].map(name => ({ name, description: 'Install', sideEffects: 'mutates-durable-state', authorization: { permission: 'plugins.install' }, inputSchema: { type: 'object' } })), catalogModule: 'host/catalog',
    installPermission: 'plugins.install', toolMetadata: {}, sha256: () => 'initial-digest', installUploadedAgentPlugin,
    previewUploadedAgentPlugin: async () => { order.push('preview'); return { digest: 'preview-digest', warning: 'OFF' }; },
    maxAgentPluginInstallArchiveBytes: () => 1024,
  } as unknown as Parameters<typeof bindAgentPluginsInstallTools>[0]);
  const registrations = bound.buildRegistrations({
    workspaceId: 'ws', authorize: async () => { order.push('authorize'); return { allowed: true }; },
    pluginInstallSource: { readRequest: () => ({ kind: 'zip' }), readArchive: async () => { order.push('read'); return archive; } },
    agentPluginLayout: { forWorkspace: () => ({ root: '/ws' }) },
  } as unknown as Parameters<typeof bound.buildRegistrations>[0]);
  const registration = registrations.find(entry => entry.descriptor.id === 'agent_plugins_install')!;
  await registration.handler({ input: {}, principal: { id: 'owner' }, run: { id: 'run' } } as Parameters<typeof registration.handler>[0]);
  expect(order).toEqual(['authorize', 'read', 'preview', 'install']);
  expect(installUploadedAgentPlugin).toHaveBeenCalledTimes(1);
});

it('passes workspacesDir to the unchanged host bundled seed function', async () => {
  const layout = { ...createAgentPluginLayout({ root: '/plugins' }), workspacesDir: '/plugins/ws' };
  const seedBundledAgentPlugins = vi.fn(async (input: { layout: AgentPluginLayout; workspaceId: string; sourceRoot: string }) => {
    expect(input.layout.workspacesDir).toBe('/plugins/ws');
    return { sourceRoot: input.sourceRoot, retirements: [], outcomes: [{ pluginId: 'sample', status: 'seeded' as const, archiveDigest: 'digest', activationRecorded: true }] };
  });
  const bound = bindAgentPluginsInstallTools({
    ...({
      catalog: ['agent_plugins_install', 'agent_plugins_update', 'agent_plugins_customize'].map(name => ({ name, description: 'Install', sideEffects: 'mutates-durable-state', authorization: { permission: 'plugins.install' }, inputSchema: { type: 'object' } })), catalogModule: 'host/catalog',
      installPermission: 'plugins.install', toolMetadata: {},
      listBundledAgentPluginServers: async () => [{ pluginId: 'sample' }],
      listInstalledPlugins: async () => [],
      agentPluginActivations: { resolveAgentPluginActivation: async () => ({ verdict: 'active' }) },
    } as unknown as Omit<Parameters<typeof bindAgentPluginsInstallTools>[0], 'seedBundledAgentPlugins'>),
    seedBundledAgentPlugins,
  });
  const registrations = bound.buildRegistrations({
    workspaceId: 'ws', authorize: async () => ({ allowed: true }),
    agentPluginLayout: layout, bundledAgentPluginsSourceRoot: '/bundled',
  } as unknown as Parameters<typeof bound.buildRegistrations>[0]);
  const registration = registrations.find(entry => entry.descriptor.id === 'agent_plugins_install')!;
  const result = await registration.handler({ input: { source: { kind: 'bundled', bundledId: 'sample' } }, principal: { id: 'owner' }, run: { id: 'run' } } as Parameters<typeof registration.handler>[0]);
  expect(seedBundledAgentPlugins).toHaveBeenCalledWith({ layout, workspaceId: 'ws', sourceRoot: '/bundled' });
  expect(result).toMatchObject({ installed: true, alreadyInstalled: false, enabled: true, plugin: { id: 'sample' } });
});

type Binding = Parameters<typeof bindAgentPluginsInstallTools>[0];
type ToolSource = import('@jini-ai/core/contracts/headless/plugin-install-source').PluginInstallSourcePort;
const updateFrom = 'a'.repeat(64);
const plugin = { pluginId: 'sample', packageRoot: '/packages/sample', archiveDigest: 'f'.repeat(64), version: '3.1.2', files: [], skills: [] };
const archive = new Uint8Array([80, 75, 3, 4]);

function toolRig(source: ToolSource['readRequest'], overrides: Partial<Binding> = {}) {
  const unexpected = () => { throw new Error('unexpected host port call'); };
  const layout = createAgentPluginLayout({ root: '/agent-plugins-test' });
  const readRequest = vi.fn<ToolSource['readRequest']>(source);
  const readArchive = vi.fn<ToolSource['readArchive']>(async ({ ownerId, runId }) => {
    if (ownerId !== 'owner' || runId !== 'run-b') throw new Error('wrong tool input scope');
    return archive;
  });
  const previewUploadedAgentPlugin = vi.fn<Binding['previewUploadedAgentPlugin']>(async () => {
    throw new Error('an update must not require the install preview');
  });
  const installUploadedAgentPlugin = vi.fn(async (_input: import('../install-upload.js').InstallUploadedAgentPluginRequired, _options?: unknown) =>
    ({ plugin, alreadyInstalled: false, enabled: true, warnings: ['Requires assistant review'] }));
  const provisioning = { provision: unexpected, setEnabled: unexpected, remove: unexpected, notifyRosterChanged: unexpected };
  const updateMcpEffects = vi.fn<Binding['updateMcpEffects']>(() => provisioning);
  const zipLocalFolder = vi.fn<Binding['zipLocalFolder']>(async ({ path }) => {
    if (path !== '/explicit/source') throw new Error('wrong source folder');
    return archive;
  });
  const prepareCustomizedAgentPluginArchive = vi.fn<Binding['prepareCustomizedAgentPluginArchive']>(async ({ ctx }) => {
    if (ctx.principal.id !== 'owner') throw new Error('wrong customizer');
    return archive;
  });
  const bind = bindAgentPluginsInstallTools({
    catalog: ['agent_plugins_install', 'agent_plugins_update', 'agent_plugins_customize'].map(name => ({
      name, description: 'Install', sideEffects: 'mutates-durable-state', authorization: { permission: 'plugins.install' }, inputSchema: { type: 'object' },
    })),
    catalogModule: 'host/catalog', toolMetadata: {}, installPermission: 'plugins.install',
    sha256: bytes => bytes === archive ? 'read-digest' : unexpected(),
    maxAgentPluginInstallArchiveBytes: () => 8192,
    listInstalledPlugins: async () => [],
    seedBundledAgentPlugins: unexpected,
    listBundledAgentPluginServers: async () => [{ pluginId: 'sample', servers: {} }],
    agentPluginActivations: { resolveAgentPluginActivation: unexpected, isAgentPluginRecordedAsBundled: unexpected },
    previewUploadedAgentPlugin, installUploadedAgentPlugin, updateMcpEffects, zipLocalFolder, prepareCustomizedAgentPluginArchive,
    ...overrides,
  });
  const readInstallAttachment: NonNullable<Parameters<typeof bind.buildRegistrations>[0]['readInstallAttachment']> = unexpected;
  const snapshotAgentPluginSettings = async () => ({});
  const registrations = bind.contributeAgentPluginsInstallTools({
    pluginInstallSource: { readRequest, readArchive }, readInstallAttachment,
  }).build({ workspaceId: 'tenant-b', agentPluginLayout: layout, bundledAgentPluginsSourceRoot: '/bundled',
    authorize: async () => ({ allowed: true, reason: 'owner' }), snapshotAgentPluginSettings }, {});
  const call = (operation: string, input: unknown) => {
    const registration = registrations.find(entry => entry.descriptor.id === 'agent_plugins_' + operation);
    if (!registration) throw new Error('missing tool ' + operation);
    return registration.handler({ input, principal: { id: 'owner' }, run: { id: 'run-b' }, executionId: 'tool-b', signal: new AbortController().signal });
  };
  return { call, readRequest, readArchive, readInstallAttachment, snapshotAgentPluginSettings, provisioning, layout, installUploadedAgentPlugin,
    previewUploadedAgentPlugin, updateMcpEffects, zipLocalFolder, prepareCustomizedAgentPluginArchive };
}

it.each([
  [{ pluginId: '../sample', expectedOldDigest: updateFrom }, 'pluginId is not a valid Agent Plugin id.'],
  [{ pluginId: 'sample', expectedOldDigest: 'A'.repeat(64) }, 'expectedOldDigest must be the installed archiveDigest (lowercase hex SHA-256).'],
] as const)('checks the update target before fetching bytes (%j)', async (input, reason) => {
  const f = toolRig(() => { throw new Error('update should refuse before source read'); });
  await expect(f.call('update', input)).rejects.toThrow(reason);
  expect(f.readRequest.mock.calls).toEqual([]);
  expect(f.installUploadedAgentPlugin.mock.calls).toEqual([]);
});

it('routes an authorized attachment update to the update owner with the old digest and MCP/settings seams', async () => {
  const request = { kind: 'zip', attachmentRef: 'attachment:fixture-1234', replace: true } as const;
  const f = toolRig(() => request);
  await expect(f.call('update', { pluginId: 'sample', expectedOldDigest: updateFrom })).resolves.toMatchObject({
    updated: true, enabled: true, alreadyInstalled: false, plugin: { id: 'sample', version: '3.1.2' },
    warnings: ['Requires assistant review'],
    note: 'Updated. Memory is kept. Running chats keep the guidance they already loaded; MCP calls in progress may fail.',
  });
  expect(f.readArchive.mock.calls).toEqual([[{ request, ownerId: 'owner', runId: 'run-b', maxBytes: 8192 },
    { readAttachment: f.readInstallAttachment }]]);
  expect(f.installUploadedAgentPlugin.mock.calls).toEqual([[{
    archive, expectedSha256: 'read-digest', actor: 'owner', workspaceId: 'tenant-b',
    update: { pluginId: 'sample', expectedOldDigest: updateFrom },
  }, { layout: f.layout, snapshotSettings: f.snapshotAgentPluginSettings, mcpProvisioning: f.provisioning }]]);
  expect(f.previewUploadedAgentPlugin.mock.calls).toEqual([]);

  f.installUploadedAgentPlugin.mockResolvedValueOnce({ plugin, alreadyInstalled: true, enabled: true, warnings: [] });
  await expect(f.call('update', { pluginId: 'sample', expectedOldDigest: updateFrom })).resolves.toMatchObject({
    updated: false, alreadyInstalled: true, enabled: true, note: 'These exact bytes are already installed; nothing changed.',
  });
  f.installUploadedAgentPlugin.mockRejectedValueOnce(new AgentPluginUpdateError({ code: 'PLUGIN_DOWNGRADE_REFUSED', message: 'Keep the current version' }));
  const refusal = await f.call('update', { pluginId: 'sample', expectedOldDigest: updateFrom }).then(() => undefined, (error: unknown) => error);
  expect(refusal).toBeInstanceOf(ToolInputError);
  expect(refusal).toHaveProperty('message', 'PLUGIN_DOWNGRADE_REFUSED: Keep the current version');
});

it('a folder without a path never opens an archive, and a bounded folder failure is caller-visible', async () => {
  const f = toolRig(() => ({ kind: 'folder', replace: false }));
  await expect(f.call('install', {})).rejects.toThrow('Agent Plugin folder source has no path');
  expect(f.zipLocalFolder.mock.calls).toEqual([]);
  f.readRequest.mockReturnValue({ kind: 'folder', path: '/explicit/source', replace: false });
  f.zipLocalFolder.mockRejectedValueOnce(new FolderZipError('unreadable', 'Could not read that folder. Try again.'));
  const refusal = await f.call('install', {}).then(() => undefined, (error: unknown) => error);
  expect(refusal).toBeInstanceOf(ToolInputError);
  expect(refusal).toHaveProperty('message', 'Could not read that folder. Try again.');
  expect(f.zipLocalFolder.mock.calls).toEqual([[{ path: '/explicit/source', maxBytes: 8192 }]]);
  expect(f.readArchive.mock.calls).toEqual([]);
  expect(f.installUploadedAgentPlugin.mock.calls).toEqual([]);
});

it('customization submits the fork as a new install, ignoring replace in the caller input', async () => {
  const preview = vi.fn<Binding['previewUploadedAgentPlugin']>(async () => ({
    pluginId: 'sample', skills: [], digest: 'approved-fork-digest', warning: 'New forks are off',
  }));
  const f = toolRig(() => { throw new Error('must not read an ordinary upload'); }, {
    previewUploadedAgentPlugin: preview,
  });
  await expect(f.call('customize', { replace: true })).resolves.toMatchObject({
    installed: true, enabled: false, alreadyInstalled: false, plugin: { id: 'sample', version: '3.1.2' }, warning: 'New forks are off',
  });
  expect(preview.mock.calls).toEqual([[{ archive, expectedSha256: 'read-digest', actor: 'owner', workspaceId: 'tenant-b', replace: false }, { layout: f.layout }]]);
  expect(f.installUploadedAgentPlugin.mock.calls).toEqual([[{ archive, expectedSha256: 'approved-fork-digest', actor: 'owner', workspaceId: 'tenant-b', replace: false }, { layout: f.layout }]]);
  expect(f.readRequest.mock.calls).toEqual([]);
});

it('a bundled ID cannot overwrite the same local ID installed from another source', async () => {
  const isAgentPluginRecordedAsBundled = vi.fn(async (_input: { workspaceRoot: string; pluginId: string }) => false);
  const f = toolRig(() => { throw new Error('bundled source must not use ordinary archive reads'); }, {
    listInstalledPlugins: async () => [plugin],
    agentPluginActivations: { isAgentPluginRecordedAsBundled, resolveAgentPluginActivation: async () => { throw new Error('activation must not be read for a refused namesake'); } },
  });
  await expect(f.call('install', { source: { kind: 'bundled', bundledId: 'sample' } }))
    .rejects.toThrow("Plugin id 'sample' is already installed from another source; bundled plugins cannot replace it.");
  expect(isAgentPluginRecordedAsBundled.mock.calls).toEqual([[{ workspaceRoot: '/agent-plugins-test/ws/tenant-b', pluginId: 'sample' }]]);
  expect(f.installUploadedAgentPlugin.mock.calls).toEqual([]);
  await expect(f.call('install', { source: { kind: 'bundled', bundledId: 'sample', path: '/other' } }))
    .rejects.toThrow("Bundled source requires only kind:'bundled' and a bundledId; no path or attachmentRef.");
  await expect(f.call('install', { source: { kind: 'zip', bundledId: 'sample' } }))
    .rejects.toThrow("source.bundledId requires kind 'bundled' and cannot be combined with a path or attachmentRef.");
  expect(f.readRequest.mock.calls).toEqual([]);
});
