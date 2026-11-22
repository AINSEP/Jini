import { createContext, useContext } from 'react';
import { AdminConfigError } from '@jini-ai/core/admin-runtime';
import type { AgentPluginsApiPort } from '../../ports.js';
import type { UseAdminController } from '@jini-ai/core/contracts/admin-module';
export interface AgentPluginsPorts { readonly agentPluginsApi: AgentPluginsApiPort }
export const AgentPluginsPortsContext = createContext<AgentPluginsPorts | null>(null);
export function useAgentPluginsPorts(_required: Record<string, never> = {}, _optional = {}) {
  const ports = useContext(AgentPluginsPortsContext);
  if (!ports) throw new AdminConfigError({ issues: ['React scope unavailable: agent-plugins'] });
  return ports;
}
/** The controller hook the host injects through the module factory (owner answer 2026-11-17, J4:
 * injected, never imported). The factory's Provider supplies it; outside it a hook fails loudly. */
export const AgentPluginsControllerContext = createContext<UseAdminController | null>(null);
function controllerMissing(): never {
  throw new AdminConfigError({ issues: ['Controller hook unavailable: agent-plugins'] });
}
export const useAgentPluginsController: UseAdminController = (required, optional = {}) => {
  const useController = useContext(AgentPluginsControllerContext) ?? controllerMissing;
  return useController(required, optional);
};
