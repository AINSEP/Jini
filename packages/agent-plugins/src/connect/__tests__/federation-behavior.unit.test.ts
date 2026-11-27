import { expect, it, vi } from 'vitest';
import { planAgentPluginMcpFederation, provisionAgentPluginMcpServers } from '../federate-mcp.js';
import { endpoint, memoryMcp, row, sealed } from './mcp-fixture.js';

const oauth = { type: 'streamable-http', authMode: 'oauth', url: endpoint } as const;
const messages = { sseTransportUnsupported: () => 'Use streamable HTTP.', headersUnsupported: () => 'Headers cannot be stored.' };
const classifyTrust = () => 'auto-admit' as const;

it('plans only admitted remote declarations whose transport, headers and id can be represented', () => {
  const manual = { ...oauth, url: 'https://manual.example.test' };
  const plan = planAgentPluginMcpFederation({ messages, classifyTrust: config => config === manual ? 'requires-confirmation' : 'auto-admit',
    servers: { 'Main OAuth': oauth, 'Plain Remote': { type: 'streamable-http', url: endpoint },
      local: { type: 'stdio', command: 'fixture' }, manual,
      events: { type: 'sse', url: endpoint }, headers: { ...oauth, headers: { 'x-project': 'studio' } }, '???': oauth,
    },
  });
  expect(plan.toUpsert).toEqual([
    { connectionId: 'main-oauth', serverKey: 'Main OAuth', url: endpoint, authMode: 'oauth', acceptsAccessToken: false },
    { connectionId: 'plain-remote', serverKey: 'Plain Remote', url: endpoint, authMode: 'none', acceptsAccessToken: false },
  ]);
  expect(plan.skipped).toEqual([
    { serverKey: 'local', reason: "declares a 'stdio' local process — requires explicit operator confirmation, never auto-wired from a plugin" },
    { serverKey: 'manual', reason: "this server's trust classification is not 'auto-admit' — refusing to wire it until this file is re-verified against classifyAgentPluginMcpServerTrust's current rule" },
    { serverKey: 'events', reason: 'Use streamable HTTP.' },
    { serverKey: 'headers', reason: 'Headers cannot be stored.' },
    { serverKey: '???', reason: "server key '???' has no valid characters to derive a connection id from" },
  ]);
});

it('reprovisions only an untouched stale row, and adopts legacy rows without replacing credentials or access', async () => {
  const adopt = row({ serverId: 'operator', provisionedByPluginId: null, allowedToolNames: '["keep"]', enabled: true });
  const stale = row({ serverId: 'stale', sealedOAuth: null, oauthStatus: 'disconnected', url: 'https://old.example.test/mcp' });
  const changed = row({ serverId: 'saved', sealedOAuth: sealed, url: 'https://kept.example.test/mcp' });
  const busy = row({ serverId: 'busy', provisionedByPluginId: 'other', url: 'https://owned.example.test/mcp' });
  const { mcp, rows } = memoryMcp(adopt, stale, changed, busy);
  const report = { warn: vi.fn() };
  const result = await provisionAgentPluginMcpServers({ deps: mcp, workspaceId: 'studio', pluginId: 'sync', principalId: 'owner',
    messages, classifyTrust, servers: { operator: oauth, stale: oauth, saved: oauth, busy: oauth } }, { report });
  expect(result).toEqual({ provisioned: ['stale'], alreadyProvisioned: ['saved'], adopted: ['operator'], skipped: [], failed: [{
    serverKey: 'busy', reason: "connection id 'busy' is owned by plugin 'other' at a different endpoint (url='https://owned.example.test/mcp', transport='streamable_http', authMode='oauth') — refusing to rebind it to plugin 'sync' (declared url='https://api.example.test/mcp', transport='streamable_http', authMode='oauth')",
  }] });
  expect(rows.get('operator')).toEqual({ ...adopt, provisionedByPluginId: 'sync', version: 4 });
  expect(rows.get('saved')).toBe(changed);
  expect(rows.get('busy')).toBe(busy);
  expect(rows.get('stale')).toMatchObject({ url: endpoint, enabled: false, oauthGrant: 'authorization_code', allowedToolNames: '[]', writeAllowedToolNames: '[]', sealedOAuth: null });
  expect(mcp.repo.deleteByServerId.mock.calls).toEqual([[{ workspaceId: 'studio', serverId: 'stale' }]]);
  expect(mcp.saveServer.mock.calls).toEqual([[{
    workspaceId: 'studio', serverId: 'stale', label: 'sync · stale', transport: 'streamable_http', authMode: 'oauth', enabled: false,
    command: '', url: endpoint, args: '', allowedToolNames: '', writeAllowedToolNames: '', oauth: { grant: 'authorization_code' }, principalId: 'owner', provisionedByPluginId: 'sync',
  }]]);
  expect(mcp.notifyRosterChanged.mock.calls).toEqual([[{}, {}]]);
});
