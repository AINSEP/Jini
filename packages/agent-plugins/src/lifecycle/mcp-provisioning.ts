import type { AgentPluginMcpProvisioningPort } from './ports.js';
import type { InstalledAgentPlugin } from './install.js';

/** A host performs MCP federation. Notify only after its durable provisioning step succeeds. */
export async function provisionAgentPluginMcp(required: {
  readonly mcpProvisioning: AgentPluginMcpProvisioningPort;
  readonly workspaceId: string;
  readonly installed: InstalledAgentPlugin;
}): Promise<void> {
  await required.mcpProvisioning.provision({ workspaceId: required.workspaceId, installed: required.installed });
  await required.mcpProvisioning.notifyRosterChanged({ workspaceId: required.workspaceId });
}
export async function syncAgentPluginMcpEnabled(required: {
  readonly mcpProvisioning: AgentPluginMcpProvisioningPort;
  readonly workspaceId: string;
  readonly pluginId: string;
  readonly enabled: boolean;
}): Promise<void> {
  await required.mcpProvisioning.setEnabled({ workspaceId: required.workspaceId, pluginId: required.pluginId, enabled: required.enabled });
  await required.mcpProvisioning.notifyRosterChanged({ workspaceId: required.workspaceId });
}
export async function removeAgentPluginMcp(required: {
  readonly mcpProvisioning: AgentPluginMcpProvisioningPort;
  readonly workspaceId: string;
  readonly pluginId: string;
}): Promise<void> {
  await required.mcpProvisioning.remove({ workspaceId: required.workspaceId, pluginId: required.pluginId });
  await required.mcpProvisioning.notifyRosterChanged({ workspaceId: required.workspaceId });
}
