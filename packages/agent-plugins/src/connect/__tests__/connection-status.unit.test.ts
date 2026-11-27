import { expect, it, vi } from 'vitest';
import type { PluginCredentialCard } from '@jini-ai/core/contracts/credentials';
import { agentPluginConnectAgentToolCatalogFor, agentPluginConnectDerivedRiskFor, hasStoredAgentPluginCredential, loadAgentPluginConnectionStatuses } from '../index.js';
import { projections, row, sealed } from './mcp-fixture.js';

const oauthCard: PluginCredentialCard = { providerId: 'oauth', label: 'Example', category: 'general', baseUrl: 'https://example.test', title: 'Sign in', saveKind: 'oauth' };
it('combines token, OAuth and API statuses without assigning badges to unrelated rows or API-key cards', async () => {
  type Reads = NonNullable<Parameters<typeof loadAgentPluginConnectionStatuses>[0]['apiConnections']>;
  const rows = [
    row({ provisionedByPluginId: 'sync' }),
    row({ provisionedByPluginId: 'sync', oauthStatus: 'pending' }),
    row({ provisionedByPluginId: 'token', authMode: 'static_env', oauthStatus: null }),
    row({ provisionedByPluginId: null }),
    row({ provisionedByPluginId: 'local', authMode: 'none', sealedOAuth: null }),
    row({ provisionedByPluginId: 'mixed', oauthStatus: 'pending' }),
    row({ provisionedByPluginId: 'mixed', oauthStatus: 'disconnected' }),
  ];
  const connections = [{ pluginId: 'sync' }, { pluginId: 'api' }, { pluginId: 'revoked' }];
  const apiConnections = {
    listConnections: vi.fn<Reads['listConnections']>(async () => connections),
    statusOf: vi.fn<Reads['statusOf']>(async ({ connection }) => {
      switch (connection.pluginId) {
        case 'sync': return { status: 'reconnect-required' };
        case 'api': return { status: 'connected' };
        case 'revoked': return { status: 'revocation-pending' };
        default: throw new Error('unlisted connection');
      }
    }),
  };
  const listByWorkspaceId = vi.fn(async () => rows);
  const loadCards = vi.fn(async (): Promise<readonly PluginCredentialCard[]> => [
    { ...oauthCard, pluginId: 'token' }, { ...oauthCard, pluginId: 'never' },
    { ...oauthCard, pluginId: 'keys', saveKind: 'api' }, oauthCard,
  ]);
  expect(await loadAgentPluginConnectionStatuses({ workspaceId: 'studio', mcp: { listByWorkspaceId }, loadCards, apiConnections, projections })).toEqual(new Map([
    ['sync', 'needs_reauth'], ['token', 'connected'], ['mixed', 'pending'], ['api', 'connected'], ['revoked', 'needs_reauth'], ['never', 'disconnected'],
  ]));
  expect(listByWorkspaceId.mock.calls).toEqual([['studio']]);
  expect(loadCards.mock.calls).toEqual([['studio']]);
  expect(apiConnections.listConnections.mock.calls).toEqual([[{}]]);
  expect(apiConnections.statusOf.mock.calls).toEqual(connections.map(connection => [{ connection }]));
});

it('returns only the disconnected OAuth badge when optional hosts are absent', async () => {
  const mcp = { listByWorkspaceId: async () => [row({ oauthStatus: 'disconnected' })] };
  expect(await loadAgentPluginConnectionStatuses({ workspaceId: 'studio', mcp, projections })).toEqual(new Map([['sync', 'disconnected']]));
});

it('publishes an exact one-input catalog with host-owned identity and durable-write risk', () => {
  const toolId = 'studio_connect';
  expect(agentPluginConnectAgentToolCatalogFor({ toolId, permission: 'studio.connections.manage', description: 'Connect an account', pluginIdDescription: 'Choose an installed plugin' })).toEqual([{
    name: toolId, description: 'Connect an account', sideEffects: 'mutates-durable-state', authorization: { permission: 'studio.connections.manage' },
    inputSchema: { type: 'object', additionalProperties: false, required: ['pluginId'], properties: {
      pluginId: { type: 'string', minLength: 1, description: 'Choose an installed plugin' },
    } },
  }]);
  expect(agentPluginConnectDerivedRiskFor({ toolId })).toEqual(new Map([['studio_connect', 'mutates-durable-state']]));
});

it.each([
  { label: 'finished OAuth', changes: { authMode: 'oauth', oauthStatus: 'connected' }, stored: true },
  { label: 'saved token', changes: { authMode: 'static_env', oauthStatus: null }, stored: true },
  { label: 'stdio environment only', changes: { authMode: 'none', oauthStatus: null, sealedOAuth: null, sealedEnv: sealed }, stored: false },
  { label: 'pending OAuth', changes: { authMode: 'oauth', oauthStatus: 'pending' }, stored: false },
])('treats $label as stored sign-in only when usable', ({ changes, stored }) => {
  expect(hasStoredAgentPluginCredential({ row: row(changes), projections })).toBe(stored);
});
