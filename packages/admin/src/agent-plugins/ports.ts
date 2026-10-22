import { adminPort } from '../core/module/token.js';
import type { AgentPluginActivationInput, AgentPluginSummary, AgentPluginFiles, AgentPluginRequestOptions } from './models.js';
/** Host owns lifecycle effects and authorization. Both list tabs read this same workspace scope. */
export interface AgentPluginsApiPort {
  list(required: Record<string, never>, optional?: AgentPluginRequestOptions): Promise<readonly AgentPluginSummary[]>;
  setEnabled(required: AgentPluginActivationInput, optional?: AgentPluginRequestOptions): Promise<AgentPluginSummary>;
  files(required: { readonly pluginId: string }, optional?: AgentPluginRequestOptions): Promise<AgentPluginFiles>;
}
export interface AgentPluginsTransportPort {
  request<T>(required: { readonly path: string; readonly method: 'GET' | 'PATCH'; readonly body?: unknown }, optional?: AgentPluginRequestOptions): Promise<T>;
}
export const agentPluginsApiToken = adminPort<AgentPluginsApiPort, 'admin.agent-plugins.api'>({ id: 'admin.agent-plugins.api' });
