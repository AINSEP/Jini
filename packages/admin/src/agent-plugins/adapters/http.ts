import type { AgentPluginsApiPort, AgentPluginsTransportPort } from '../ports.js';
import type { AgentPluginSummary, AgentPluginFiles, AgentPluginRequestOptions } from '../models.js';
import { agentPluginSummary, agentPluginFilesSnapshot } from '../rules.js';
/** Existing workspace routes. Auth, JSON serialization and response decoding belong to transport. */
export function createHttpAgentPluginsApi({ transport, workspacePath }: { transport: AgentPluginsTransportPort; workspacePath: string }, _optional = {}): AgentPluginsApiPort {
  const base = `${workspacePath.replace(/\/$/, '')}/agent-plugins`;
  function request<T>(suffix: string, method: 'GET' | 'PATCH', options: AgentPluginRequestOptions, body?: unknown) {
    options.signal?.throwIfAborted(); return transport.request<T>({ path: `${base}${suffix}`, method, ...(body === undefined ? {} : { body }) }, options);
  }
  return {
    async list(_required, options = {}) { const r = await request<{ agentPlugins: readonly AgentPluginSummary[] }>('', 'GET', options); return Object.freeze(r.agentPlugins.map(row => agentPluginSummary({ row }))); },
    async setEnabled({ pluginId, enabled }, options = {}) { const r = await request<{ agentPlugin: AgentPluginSummary }>(`/${encodeURIComponent(pluginId)}`, 'PATCH', options, { enabled }); return agentPluginSummary({ row: r.agentPlugin }); },
    async files({ pluginId }, options = {}) { const r = await request<AgentPluginFiles>(`/${encodeURIComponent(pluginId)}/files`, 'GET', options); return agentPluginFilesSnapshot({ listing: r }); },
  };
}
