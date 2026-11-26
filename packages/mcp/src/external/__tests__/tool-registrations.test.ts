import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { ExternalMcpServerRecord } from '@jini-ai/core/contracts/hosted-mcp';
import type { ToolExecutionContext } from '@jini-ai/core';
import type { SurfaceCardsPort } from '@jini-ai/core/contracts/cards';
import { createExternalMcpAgentToolCatalog } from '../agent-tools.js';
import { buildExternalMcpRegistrations, type ExternalMcpToolDeps } from '../tool-registrations.js';

test('a changed connection after the card requires a new approval and performs no write', async () => {
  let record: ExternalMcpServerRecord = { workspaceId: 'ws', serverId: 'server', label: null, provisionedByPluginId: null,
    transport: 'streamable_http', authMode: 'none', enabled: true, command: null, url: 'https://example.com/mcp', args: null, allowedToolNames: null,
    writeAllowedToolNames: null, writeGrantsUpdatedByPrincipalId: null, writeGrantsUpdatedAt: null, envNames: null,
    sealedEnv: null, oauthProviderId: null, oauthGrant: null, oauthClientId: null, oauthEndpointsJson: null, oauthScopesJson: null,
    oauthStatus: null, oauthExpiresAt: null, oauthTokenEnvName: null, oauthRefreshLeaseUntil: null, sealedOAuth: null,
    aadVersion: 1, oauthAadVersion: 1, createdAt: 'stamp', updatedAt: 'stamp', version: 1 };
  let writes = 0;
  let reads = 0;
  const defineSecretCardTool: SurfaceCardsPort['defineSecretCardTool'] = spec => ({ toolId: spec.toolId, secretFieldNames: () => [],
    handler: () => async ctx => {
      const prep = await spec.prepare({ ctx });
      record = { ...record, url: 'https://changed.example/mcp', version: 2 };
      await spec.save({ prep, values: { label: 'Reviewed' }, signal: ctx.signal });
      throw new Error('old approval reached the writer');
    },
  });
  const deps = { workspaceId: 'ws', authorize: async () => ({ allowed: true }), clock: { nowMs: () => 0 },
    externalMcpServerRepo: { findByServerId: async () => { reads++; return record; } },
    catalog: createExternalMcpAgentToolCatalog({ copy: { settingsLocation: 'Settings', listToolName: 'external_mcp_list' } }),
    requireToolPermission: async () => {}, assertCredentialFreeField: () => {}, defineSecretCardTool,
    resolveOperatorLocale: async () => 'en', listExternalMcpServerViews: async () => [],
    saveExternalMcpServer: async () => { writes++; throw new Error('unexpected save'); },
  } as unknown as ExternalMcpToolDeps;
  const surfaces = { assertAccessApprover: async () => {}, surfaceExchanges: {} };
  const tool = buildExternalMcpRegistrations(deps, surfaces as never).find(item => item.descriptor.id === 'external_mcp_save')!;
  const ctx: ToolExecutionContext = { executionId: 'exec', principal: { id: 'person' }, run: { id: 'run' },
    input: { id: 'server', transport: 'streamable_http', url: 'https://example.com/mcp', authMode: 'none' }, signal: new AbortController().signal };
  await assert.rejects(tool.handler(ctx), /reviewed External MCP connection changed/);
  assert.equal(reads, 2);
  assert.equal(writes, 0);
});
