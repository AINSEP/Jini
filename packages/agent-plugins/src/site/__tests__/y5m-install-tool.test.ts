import { expect, it, vi } from 'vitest';
import { bindAgentPluginsInstallTools } from '../install-tool.js';

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
