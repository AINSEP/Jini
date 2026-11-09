import { expect, test } from 'vitest';
import { previewAgentPluginEnableAccess } from '../enable-access.js';
import { createApplyConnectDefaults } from '../apply-connect-defaults.js';
import type { AgentPluginMcpRecord, AgentPluginMcpProjectionPorts } from '../ports.js';

const rejected = new Error('host tool limit');
const messages = {
  sourceConfiguredSeparately: () => 'host source mismatch',
  sseTransportUnsupported: () => 'host sse', headersUnsupported: () => 'host headers',
  combinedGrantRejected: ({ detail }: { detail: string }) => `Host repair: ${detail}. Use acme_select_tools.`,
};
const row = { serverId: 'alpha', provisionedByPluginId: 'plugin', enabled: false,
  url: 'https://alpha.example/mcp', transport: 'streamable_http', authMode: 'oauth',
  allowedToolNames: null, writeAllowedToolNames: null, writeGrantsUpdatedByPrincipalId: null,
} as AgentPluginMcpRecord;
const repo: Parameters<typeof previewAgentPluginEnableAccess>[0]['repo'] = {
  findByServerId: async () => row, upsert: async () => {}, deleteByServerId: async () => true, updateAccessIfCurrent: async () => true,
};
const ports: AgentPluginMcpProjectionPorts = {
  classifyError: () => 'validation',
  projections: {
    accessSnapshot: () => ({}) as never, admissionRevision: () => 'revision',
    readToolGrants: () => ({ allowedToolNames: [], writeAllowedToolNames: [] }),
    validateToolNames: () => { throw rejected; }, oauthStatus: () => 'connected', hasStaticAccessToken: () => false,
  },
};
const servers = { alpha: { type: 'streamable-http', url: row.url!, authMode: 'oauth', defaultTools: { allow: ['read'], write: [] } } } as const;
test('enable preview uses the host grant-repair copy', async () => {
  await expect(previewAgentPluginEnableAccess({ ...ports, workspaceId: 'ws', pluginId: 'plugin',
    servers, repo, classifyTrust: () => 'auto-admit', messages,
  })).rejects.toThrow('Host repair: host tool limit. Use acme_select_tools.');
});
test('sign-in default grants use the same host grant-repair copy before any write', async () => {
  let writes = 0;
  const grant = createApplyConnectDefaults({ ...ports, workspaceId: 'ws', repo,
    clock: { nowMs: () => 0 }, resolveServers: async () => servers,
    enablePlugin: async () => { writes++; }, applyAccess: async () => { writes++; },
    actors: { connectDefaults: 'host:defaults', connectDeclined: 'host:declined' },
    notifyRosterChanged: async () => {}, isPluginOffByOperator: async () => false,
    combinedGrantRejected: messages.combinedGrantRejected,
  });
  await expect(grant('alpha')).rejects.toThrow('Host repair: host tool limit. Use acme_select_tools.');
  expect(writes).toBe(0);
});
