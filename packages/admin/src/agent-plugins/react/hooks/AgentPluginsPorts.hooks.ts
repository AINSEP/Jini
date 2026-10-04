import { createContext, useContext } from 'react';
import { AdminConfigError } from '../../../core/module/index.js';
import type { AgentPluginsApiPort } from '../../ports.js';
export interface AgentPluginsPorts { readonly agentPluginsApi: AgentPluginsApiPort }
export const AgentPluginsPortsContext = createContext<AgentPluginsPorts | null>(null);
export function useAgentPluginsPorts(_required: Record<string, never> = {}, _optional = {}) {
  const ports = useContext(AgentPluginsPortsContext);
  if (!ports) throw new AdminConfigError({ issues: ['React scope unavailable: agent-plugins'] });
  return ports;
}
