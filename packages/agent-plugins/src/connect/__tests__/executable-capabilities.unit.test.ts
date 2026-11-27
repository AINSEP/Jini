import type { ToolExecutionContext } from '@jini-ai/core';
import type { HttpClientPort } from '@jini-ai/core/primitives';
import { expect, it, vi } from 'vitest';
import { APPROVAL_FAMILY_BY_EFFECT, createAgentPluginDisclosure } from '../executable/approval.js';
import { confirmedTokenOptions, createAgentPluginToolCapabilities, createFrozenConnectionAccounts, createGuardedPluginHttp } from '../executable/host-capabilities.js';
import type { AgentPluginConnectionAccess, AgentPluginRateLimiter, AgentPluginArtifactWriter, AgentPluginStateReaderFor } from '../executable/ports.js';

const scope = { workspaceId: 'studio', pluginId: 'sync' };
const endpoint = 'https://api.example.test/items';
const approvalInput = (signal: AbortSignal) => {
  const ctx: ToolExecutionContext = { executionId: 'call', principal: { id: 'operator' }, run: { id: 'run' }, signal, input: { connectionRef: 'alpha' } };
  return { ...scope, ctx, toolId: 'sync_replace' };
};
function fixture() {
  const send = vi.fn<HttpClientPort['send']>(async () => ({ status: 200, headers: { 'content-type': 'application/json' }, bodyText: '{"items":["A"]}' }));
  const connections = {
    readAccount: vi.fn<AgentPluginConnectionAccess['readAccount']>(async ({ connectionRef }) =>
      connectionRef === 'alpha' ? { accountId: 'account-1', displayName: 'Team One' } : null),
    getAccessToken: vi.fn<AgentPluginConnectionAccess['getAccessToken']>(async ({ connectionRef }, options) => {
      if (connectionRef !== 'alpha' || (options?.expectedAccountId && options.expectedAccountId !== 'account-1')) throw new Error('Account changed');
      return 'fixture-token';
    }),
  };
  const check = vi.fn<AgentPluginRateLimiter['check']>(async () => ({ allowed: false, retryAfterSeconds: 17 }));
  const write = vi.fn<AgentPluginArtifactWriter['write']>(async ({ name }) => ({ artifactRef: `ref:${name}` }));
  const get = vi.fn(async ({ key }: { key: string }) => key === 'products' ? { sync: true } : null);
  const state = vi.fn<AgentPluginStateReaderFor>(() => ({ get }));
  const apiOrigins = vi.fn(async () => ['https://api.example.test']);
  const frozen = createFrozenConnectionAccounts();
  const required = { connections, http: { send }, limiter: { check }, state, apiOrigins, frozen };
  return { required, send, connections, check, write, get, state, apiOrigins, frozen };
}

it('disclosure binds the displayed account to a write and approves no other connection', async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const describeAffectedResources = vi.fn(async () => ({ effect: 'write' as const, connections: ['alpha'], resources: ['Ledger row 7'] }));
  const disclose = createAgentPluginDisclosure({ ...f, source: { describeAffectedResources }, messages: {
    withdrawn: 'Tool withdrawn.', notConnected: 'Connect first.', accountLabel: 'Signed in as', affectsLabel: 'Changes',
  } });
  expect(APPROVAL_FAMILY_BY_EFFECT).toEqual({ read: 'agent-plugin-read', write: 'agent-plugin-write', destructive: 'agent-plugin-destructive' });
  expect(await disclose(approvalInput(signal))).toEqual([{ label: 'Signed in as', value: 'Team One' }, { label: 'Changes', value: 'Ledger row 7' }]);
  expect(describeAffectedResources.mock.calls).toEqual([[{ toolId: 'sync_replace', input: { connectionRef: 'alpha' } }]]);
  expect(f.connections.readAccount.mock.calls).toEqual([[{ ...scope, connectionRef: 'alpha' }]]);
  const capabilities = createAgentPluginToolCapabilities(f.required)({ ...scope, signal });
  await expect(capabilities.connections.getAccessToken({ connectionRef: 'beta' })).rejects.toThrow('This call was approved for another connection, so it cannot use this one.');
  expect(await capabilities.connections.getAccessToken({ connectionRef: 'alpha' })).toBe('fixture-token');
  expect(f.connections.getAccessToken.mock.calls).toEqual([[{ ...scope, connectionRef: 'alpha' }, { expectedAccountId: 'account-1' }]]);
  expect(confirmedTokenOptions({ frozen: f.frozen, signal: new AbortController().signal, connectionRef: 'alpha' })).toEqual({});
});

it('missing accounts refuse by default and are left unbound only for a sign-in action', async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const disclose = createAgentPluginDisclosure({ ...f, source: { describeAffectedResources: async () => ({ effect: 'write' as const, connections: ['beta'], resources: ['Account binding'] }) },
    messages: { withdrawn: 'Tool withdrawn.', notConnected: 'Connect first.', accountLabel: 'Account', affectsLabel: 'Affects' },
  });
  await expect(disclose(approvalInput(signal))).rejects.toThrow('Connect first.');
  expect(f.frozen.lookup({ signal, connectionRef: 'beta' })).toBeUndefined();
  expect(await disclose(approvalInput(signal), { skipUnconnected: true })).toEqual([{ label: 'Affects', value: 'Account binding' }]);
  expect(f.frozen.lookup({ signal, connectionRef: 'beta' })).toBeNull();
});

it('cannot confirm a withdrawn tool', async () => {
  const f = fixture();
  const disclose = createAgentPluginDisclosure({ ...f, source: { describeAffectedResources: async () => null },
    messages: { withdrawn: 'Tool withdrawn.', notConnected: 'Connect first.', accountLabel: 'Account', affectsLabel: 'Affects' },
  });
  await expect(disclose(approvalInput(new AbortController().signal))).rejects.toThrow('Tool withdrawn.');
  expect(f.connections.readAccount.mock.calls).toEqual([]);
});

it('pins HTTP origin, redirect policy, limits and both sources of cancellation', async () => {
  const f = fixture();
  const tool = new AbortController(), plugin = new AbortController();
  const http = createAgentPluginToolCapabilities(f.required)({ ...scope, signal: tool.signal }).http;
  await expect(http.fetch({ url: 'https://api.example.test.other.test/items' })).rejects.toThrow('Plugin tools may only call the API addresses their plugin declares.');
  await expect(http.fetch({ url: 'http://api.example.test/items' })).rejects.toThrow('Plugin tools may only call https:// addresses.');
  expect(f.send.mock.calls).toEqual([]);
  const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"id":7}', signal: plugin.signal } as const;
  expect(await (await http.fetch({ url: endpoint }, init)).json()).toEqual({ items: ['A'] });
  const signal = f.send.mock.calls[0]?.[0].request.signal;
  expect(f.send.mock.calls).toEqual([[{ request: {
    url: endpoint, method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"id":7}',
    signal, idleTimeoutMs: 30_000, maxResponseBytes: 1024 * 1024,
  } }, { redirect: 'error' }]]);
  expect(signal?.aborted).toBe(false);
  const pluginReason = new Error('plugin cancelled');
  plugin.abort(pluginReason);
  expect(signal?.reason).toBe(pluginReason);
  const another = new AbortController();
  await http.fetch({ url: endpoint }, { signal: another.signal });
  const toolReason = new Error('tool cancelled');
  tool.abort(toolReason);
  expect(f.send.mock.calls[1]?.[0].request.signal?.reason).toBe(toolReason);
  expect(f.apiOrigins.mock.calls).toEqual([[scope], [scope], [scope]]);
});

it('passes a single signal through unchanged, preserves bodyless HTTP and refuses truncated replies', async () => {
  const f = fixture();
  const http = createAgentPluginToolCapabilities(f.required)(scope).http;
  const signal = new AbortController().signal;
  f.send.mockResolvedValueOnce({ status: 204, headers: { 'x-fixture': 'created' }, bodyText: '' })
    .mockResolvedValueOnce({ status: 200, headers: {}, bodyText: 'partial', bodyTruncated: true });
  const response = await http.fetch({ url: endpoint }, { signal });
  expect({ status: response.status, header: response.headers.get('x-fixture'), body: response.body }).toEqual({ status: 204, header: 'created', body: null });
  expect(f.send.mock.calls[0]).toEqual([{ request: { url: endpoint, method: 'GET', headers: {}, idleTimeoutMs: 30_000, maxResponseBytes: 1024 * 1024, signal } }, { redirect: 'error' }]);
  await expect(http.fetch({ url: endpoint })).rejects.toThrow('The service returned more data than a plugin tool may read at once.');
  expect(f.send.mock.calls[1]?.[0].request).not.toHaveProperty('signal');
  expect(await (await createGuardedPluginHttp({ http: { send: f.send } }).fetch({ url: endpoint })).json()).toEqual({ items: ['A'] });
});

it('scopes rate budgets, state reads and optional artifact writes to the caller', async () => {
  const f = fixture();
  const caps = createAgentPluginToolCapabilities(f.required, { artifacts: { write: f.write } })(scope);
  expect(await caps.limiter.check({ key: 'daily' })).toEqual({ allowed: false, retryAfterSeconds: 17 });
  expect(f.check.mock.calls).toEqual([[{ key: 'studio\u0000sync\u0000daily' }]]);
  expect(await caps.state.get({ key: 'products' })).toEqual({ sync: true });
  expect(Object.keys(caps.state)).toEqual(['get']);
  expect(f.state.mock.calls).toEqual([[scope]]);
  expect(f.get.mock.calls).toEqual([[{ key: 'products' }]]);
  const content = { name: 'report.txt', mediaType: 'text/plain', content: 'fixture' };
  expect(await caps.artifacts?.write(content)).toEqual({ artifactRef: 'ref:report.txt' });
  expect(f.write.mock.calls).toEqual([[{ ...scope, ...content }]]);
  expect(createAgentPluginToolCapabilities(f.required)(scope).artifacts).toBeUndefined();
});
