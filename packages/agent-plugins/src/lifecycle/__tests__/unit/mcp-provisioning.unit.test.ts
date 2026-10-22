import { test, expect } from 'vitest';
import { provisionAgentPluginMcp, syncAgentPluginMcpEnabled, removeAgentPluginMcp, type AgentPluginMcpProvisioningPort, type InstalledAgentPlugin } from '../../index.js';

const installed: InstalledAgentPlugin = { pluginId: 'fixture', archiveDigest: 'a'.repeat(64), packageRoot: '/explicit/plugins/fixture', files: [], skills: [] };
test('provisioning delegates the unchanged install and notifies after durable changes', async () => {
  const calls: unknown[] = [];
  const port: AgentPluginMcpProvisioningPort = {
    provision: async input => { calls.push(['provision', input]); },
    setEnabled: async input => { calls.push(['enabled', input]); },
    remove: async input => { calls.push(['remove', input]); },
    notifyRosterChanged: async input => { calls.push(['notify', input]); },
  };
  await provisionAgentPluginMcp({ mcpProvisioning: port, workspaceId: 'workspace-a', installed });
  await syncAgentPluginMcpEnabled({ mcpProvisioning: port, workspaceId: 'workspace-a', pluginId: 'fixture', enabled: false });
  await removeAgentPluginMcp({ mcpProvisioning: port, workspaceId: 'workspace-a', pluginId: 'fixture' });
  expect(calls).toEqual([
    ['provision', { workspaceId: 'workspace-a', installed }], ['notify', { workspaceId: 'workspace-a' }],
    ['enabled', { workspaceId: 'workspace-a', pluginId: 'fixture', enabled: false }], ['notify', { workspaceId: 'workspace-a' }],
    ['remove', { workspaceId: 'workspace-a', pluginId: 'fixture' }], ['notify', { workspaceId: 'workspace-a' }],
  ]);
});
test('failed provisioning never sends a roster change and preserves the original error', async () => {
  let notifications = 0;
  const error = new Error('host provision failed');
  const port: AgentPluginMcpProvisioningPort = { provision: async () => { throw error; }, setEnabled: async () => {}, remove: async () => {}, notifyRosterChanged: async () => { notifications++; } };
  await expect(provisionAgentPluginMcp({ mcpProvisioning: port, workspaceId: 'workspace-a', installed })).rejects.toBe(error);
  expect(notifications).toBe(0);
});
