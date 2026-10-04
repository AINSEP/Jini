import type { AgentPluginsApiPort } from '../ports.js';
import type { AgentPluginSummary, AgentPluginFiles } from '../models.js';
import { agentPluginSummary, agentPluginFilesSnapshot } from '../rules.js';
/** Presentation backend only. No lifecycle install, trust, activation-file or MCP rules copied. */
export function createMemoryAgentPluginsApi({ plugins = [], files = {} }: { plugins?: readonly AgentPluginSummary[]; files?: Readonly<Record<string, AgentPluginFiles>> }, _optional = {}): AgentPluginsApiPort {
  const rows = new Map(plugins.map(row => [row.pluginId, agentPluginSummary({ row })]));
  const listings = new Map(Object.entries(files).map(([id, listing]) => [id, agentPluginFilesSnapshot({ listing })]));
  function notFound(): never { throw Object.assign(new Error('Agent plugin not found'), { code: 'AGENT_PLUGIN_NOT_FOUND' }); }
  return {
    async list(_required, options = {}) { options.signal?.throwIfAborted(); return Object.freeze([...rows.values()]); },
    async setEnabled({ pluginId, enabled }, options = {}) {
      options.signal?.throwIfAborted(); if (typeof enabled !== 'boolean') throw Object.assign(new Error('Invalid activation'), { code: 'VALIDATION_ERROR' });
      const row = rows.get(pluginId); if (!row) return notFound();
      const updated = agentPluginSummary({ row: { ...row, enabled } }); rows.set(pluginId, updated); return updated;
    },
    async files({ pluginId }, options = {}) { options.signal?.throwIfAborted(); if (!rows.has(pluginId)) return notFound(); const listing = listings.get(pluginId); if (!listing) return agentPluginFilesSnapshot({ listing: { pluginId, files: [], truncated: false, limits: { maxFiles: 200, maxEntries: 2000, maxFileBytes: 524288, maxTotalBytes: 4194304 } } }); return listing; },
  };
}
