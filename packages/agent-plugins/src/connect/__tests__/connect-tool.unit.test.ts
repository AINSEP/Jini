import type { ToolExecutionContext, ToolExecutionOptions } from '@jini-ai/core';
import { expect, it, vi } from 'vitest';
import { runAgentPluginConnect } from '../connect-tool.js';
import type { AgentPluginConnectApiConnectionsPort, AgentPluginConnectDeps, AgentPluginConnectHost, AgentPluginConnectOptions } from '../contracts.js';
import { endpoint, memoryMcp, row, sealed } from './mcp-fixture.js';

const oauth = { type: 'streamable-http', authMode: 'oauth', url: endpoint } as const;
const token = { type: 'streamable-http', url: endpoint, tokenAuth: { helpUrl: 'https://api.example.test/help', probeUrl: 'https://api.example.test/me' } } as const;
const surfaces = { channel: 'studio' };
const declaredConnection = { connectionRef: 'api-19' };
type Deps = AgentPluginConnectDeps<typeof surfaces, typeof declaredConnection>;
type Host = AgentPluginConnectHost<typeof surfaces>;

function fixture() {
  const ctx: ToolExecutionContext = { executionId: 'call', principal: { id: 'owner' }, run: { id: 'run' }, input: { pluginId: 'sync' }, signal: new AbortController().signal };
  const { rows, mcp } = memoryMcp(row({ oauthStatus: 'disconnected', sealedOAuth: null }));
  const describe = vi.fn();
  const approvalDecisions: ('approve' | 'declined' | 'expired' | 'abandoned')[] = [];
  const approvals: Host['approvals'] = {
    accessApprovalHandler(required, options) {
      return async (ctx, executionOptions = {}) => {
        const prepared = await required.prepare({ ctx }, executionOptions);
        if (options.ask({ prepared })) {
          describe(required.describe({ ctx, prepared }));
          const decision = approvalDecisions.shift();
          if (!decision) throw new Error('missing fixture decision');
          if (decision !== 'approve') return options.declined({ reason: decision, prepared });
        }
        return required.run({ ctx, prepared }, executionOptions);
      };
    },
    notConfirmedResult: ({ reason }) => ({ cancelled: true, ...(reason === 'declined' ? {} : { reason }), note: 'Consent was not granted.' }),
  };
  const showSignIn = vi.fn(async (_input: { signInUrl: string }) => {});
  const waiter = new AbortController();
  const host = {
    toolId: 'studio_connect', permissions: { connect: 'studio.connect', apiConnectionWrite: 'studio.write-connection' },
    entityType: 'plugin', approvalErrorCode: 'needs-consent', approvals,
    messages: {
      signInRefused: ({ detail }) => `Sign-in not opened: ${detail}`,
      unsupportedSignIn: ({ kind }) => `Unsupported sign-in: ${kind}`,
      connectionNotSetUp: ({ serverKey }) => `Not provisioned: ${serverKey}`,
      multipleTokenServers: ({ pluginId }) => `Too many token servers for ${pluginId}`,
      noTokenCardAdapter: () => 'Token card unavailable',
      pluginOff: ({ pluginId }, options) => `Enable ${pluginId} first.${options?.credentialCards?.length ? ' Use its key card.' : ''}`,
      notInstalled: ({ pluginId }) => `Plugin not installed: ${pluginId}`,
      noOAuthService: () => 'OAuth service missing',
      multipleOAuthServers: ({ serverKeys }) => `Choose one server: ${serverKeys.join(', ')}`,
      noConnection: ({ pluginId }) => `No sign-in for ${pluginId}`,
      multipleApiConnections: ({ count }) => `Too many API connections: ${count}`,
      missingEmitter: () => 'Open sign-in in chat',
    },
    publicUrl: { redirectUri: ({ serverId }) => `https://studio.example.test/callback/${serverId}` },
    federation: { classifyTrust: () => 'auto-admit', messages: {
      combinedGrantRejected: ({ detail }) => detail, sourceConfiguredSeparately: ({ connectionId }) => `Access not owned: ${connectionId}`,
      sseTransportUnsupported: () => 'No SSE', headersUnsupported: () => 'No headers',
    } },
    actors: { connectDeclined: 'studio:declined' },
    chooseDestination: vi.fn<Host['chooseDestination']>(async () => 'site'),
    waitAtSignInCard: vi.fn<Host['waitAtSignInCard']>(async ({ connect }) => connect({ signal: waiter.signal, showSignIn })),
  } satisfies Host;
  const readInstalled = vi.fn<Deps['resolveInstalledPlugin']>(async () => ({ servers: {} }));
  const isPluginEnabled = vi.fn<Deps['isPluginEnabled']>(async () => true);
  const authorize = vi.fn<Deps['authorize']>(async () => ({ allowed: true, reason: 'operator grant' }));
  const loadSafe = vi.fn<Deps['credentials']['loadSafe']>(async () => []);
  const deps = { workspaceId: 'studio', isPluginEnabled, resolveInstalledPlugin: readInstalled, credentials: { loadSafe }, authorize, mcp, host } satisfies Deps;
  const emitSurface = vi.fn(async () => {});
  const run = (overrides: Partial<Deps> = {}, options: AgentPluginConnectOptions = {}) => runAgentPluginConnect({
    routeDeps: { ...deps, ...overrides }, surfaces, pluginId: 'sync', ctx,
  }, options);
  return { run, ctx, rows, mcp, host, authorize, readInstalled, isPluginEnabled, loadSafe, describe, approvalDecisions, showSignIn, waiter, emitSurface };
}

it('an off plugin can point to its key card but never provisions a connection', async () => {
  const f = fixture();
  f.isPluginEnabled.mockResolvedValue(false);
  f.readInstalled.mockResolvedValue({ servers: { main: token }, credentialCards: [{
    providerId: 'sync', label: 'Sync', category: 'general', title: 'Token', baseUrl: 'https://api.example.test',
  }] });
  await expect(f.run()).rejects.toThrow('Enable sync first. Use its key card.');
  expect(f.readInstalled.mock.calls).toEqual([['sync']]);
  expect(f.mcp.repo.findByServerId.mock.calls).toEqual([]);
  expect(f.mcp.saveServer.mock.calls).toEqual([]);
});

it('refuses absent installation, missing declarations and missing OAuth service before a save', async () => {
  const f = fixture();
  f.readInstalled.mockResolvedValueOnce(null).mockResolvedValueOnce({ servers: {} }).mockResolvedValueOnce({ servers: { main: oauth } });
  await expect(f.run()).rejects.toThrow('Plugin not installed: sync');
  await expect(f.run()).rejects.toThrow('No sign-in for sync');
  await expect(f.run()).rejects.toThrow('OAuth service missing');
  expect(f.mcp.saveServer.mock.calls).toEqual([]);
  expect(f.host.waitAtSignInCard.mock.calls).toEqual([]);
});

it('token-only sign-in delegates to the existing card and preserves saved and refused outcomes', async () => {
  const f = fixture();
  f.readInstalled.mockResolvedValue({ servers: { main: token } });
  const saveToken = vi.fn<NonNullable<AgentPluginConnectOptions['saveToken']>>()
    .mockResolvedValueOnce({ saved: true, next: 'Edit preferences.' })
    .mockResolvedValueOnce({ saved: false, reason: 'refused', message: 'Use a read token.' })
    .mockResolvedValueOnce({ saved: false, reason: 'cancelled' });
  const options = { saveToken, emitSurface: f.emitSurface };
  await expect(f.run()).rejects.toThrow('Token card unavailable');
  expect(await f.run({}, options)).toEqual({ status: 'connected', next: 'Edit preferences.' });
  expect(await f.run({}, options)).toEqual({ status: 'not-connected', reason: 'refused', message: 'Use a read token.' });
  expect(await f.run({}, options)).toEqual({ status: 'not-connected', reason: 'cancelled' });
  expect(saveToken.mock.calls).toEqual(Array(3).fill([{ ctx: f.ctx, pluginId: 'sync' }, { emitSurface: f.emitSurface }]));
  expect(f.mcp.saveServer.mock.calls).toEqual([]);
});

function apiFixture() {
  const f = fixture();
  const listConnections = vi.fn<AgentPluginConnectApiConnectionsPort<typeof declaredConnection>['listConnections']>(async () => [declaredConnection]);
  const connect = vi.fn<AgentPluginConnectApiConnectionsPort<typeof declaredConnection>['connect']>(async ({ showSignIn }) => {
    await showSignIn({ signInUrl: '/api/connect' });
    return { status: 'connected', connectionRef: 'api-19' };
  });
  return { ...f, apiConnections: { listConnections, connect, sharingAvailable: true } };
}

it('API connection sign-in forwards the owner’s shared destination and the wait selected for this call', async () => {
  const f = apiFixture();
  f.host.chooseDestination.mockResolvedValue('shared');
  const options: ToolExecutionOptions = { emitSurface: f.emitSurface };
  expect(await f.run({ apiConnections: f.apiConnections, ownerPrincipalId: Promise.resolve('owner'), pollIntervalMs: 17, waitTimeoutMs: 400 }, options)).toEqual({ status: 'connected', connectionRef: 'api-19' });
  expect(f.apiConnections.listConnections.mock.calls).toEqual([[{ pluginId: 'sync' }]]);
  expect(f.host.chooseDestination.mock.calls).toEqual([[{ surfaces, ctx: f.ctx, pluginDisplayName: 'Sync', available: true }, options]]);
  expect(f.apiConnections.connect.mock.calls).toEqual([[{ destination: 'shared', connection: declaredConnection, actorId: 'owner', signal: f.waiter.signal,
    pollIntervalMs: 17, waitTimeoutMs: 400, showSignIn: f.showSignIn }]]);
  expect(f.showSignIn.mock.calls).toEqual([[{ signInUrl: '/api/connect' }]]);
});

it('a non-owner sees no sharing option and cancellation never signs in', async () => {
  const f = apiFixture();
  f.host.chooseDestination.mockResolvedValue(null);
  expect(await f.run({ apiConnections: f.apiConnections, ownerPrincipalId: Promise.resolve('installation-owner') })).toEqual({
    status: 'not-connected', reason: 'cancelled', next: 'Sign-in was cancelled. Continue without this connection.',
  });
  expect(f.host.chooseDestination.mock.calls).toEqual([[{ surfaces, ctx: f.ctx, pluginDisplayName: 'Sync', available: false }, {}]]);
  expect(f.apiConnections.connect.mock.calls).toEqual([]);
  expect(f.host.waitAtSignInCard.mock.calls).toEqual([]);
});

it('declining a retained token’s access proposal saves only the decline marker and never opens a token card', async () => {
  const f = fixture();
  const saved = row({ authMode: 'static_env', oauthStatus: null });
  f.rows.set('main', saved);
  f.readInstalled.mockResolvedValue({ servers: { main: { ...token, defaultTools: { allow: ['read'], write: [] } } } });
  f.approvalDecisions.push('declined');
  const saveToken = vi.fn<NonNullable<AgentPluginConnectOptions['saveToken']>>();
  expect(await f.run({}, { saveToken })).toEqual({ status: 'not-connected', cancelled: true, note: 'Consent was not granted.' });
  expect(f.describe.mock.calls).toEqual([[{
    toolId: 'studio_connect', errorCode: 'needs-consent', title: 'Allow access for sync?',
    access: { resources: [{
      id: 'main', label: 'External MCP source: https://api.example.test/mcp',
      previous: { enabled: false, allow: [], write: [] }, proposed: { enabled: true, allow: ['read'], write: [] },
      revision: 'source:https://api.example.test/mcp:static_env', scope: { personId: 'owner', siteId: 'studio' },
    }] },
    details: [], description: 'Your existing sign-in is reused. Only the listed access is turned on.', confirmLabel: 'Allow access',
  }]]);
  expect(f.rows.get('main')).toMatchObject({ enabled: false, allowedToolNames: '[]', sealedOAuth: saved.sealedOAuth, writeGrantsUpdatedByPrincipalId: 'studio:declined' });
  expect(saveToken.mock.calls).toEqual([]);
});

function mcpOAuth() {
  type Service = NonNullable<Deps['externalMcpOAuth']>;
  return {
    beginConnect: vi.fn<Service['beginConnect']>(async () => ({
      kind: 'redirect_required', authorizationUrl: 'https://proxy.example.test/owner/sign-in?private=fixture',
      expiresAt: '2030-01-01T00:05:00Z',
    })),
    isSignInRefusal: vi.fn<Service['isSignInRefusal']>(() => false),
  };
}

it('waits at a same-origin MCP sign-in link, then observes the stored credential without returning the link', async () => {
  const f = fixture();
  const externalMcpOAuth = mcpOAuth();
  f.readInstalled.mockResolvedValue({ servers: { main: oauth } });
  f.showSignIn.mockImplementationOnce(async () => { f.rows.set('main', row({ sealedOAuth: sealed, oauthStatus: 'connected' })); });
  expect(await f.run({ externalMcpOAuth }, { emitSurface: f.emitSurface })).toEqual({ status: 'connected' });
  expect(externalMcpOAuth.beginConnect.mock.calls).toEqual([[{ serverId: 'main', redirectUri: 'https://studio.example.test/callback/main', delivery: 'hosted' }]]);
  expect(f.showSignIn.mock.calls).toEqual([[{ signInUrl: '/owner/sign-in' }]]);
  expect(f.mcp.saveServer.mock.calls).toEqual([]);
  expect(f.describe.mock.calls).toEqual([]);
});

it('a bounded MCP wait without a confirmed credential stays waiting rather than claiming success', async () => {
  const f = fixture();
  const externalMcpOAuth = mcpOAuth();
  f.readInstalled.mockResolvedValue({ servers: { main: oauth } });
  expect(await f.run({ externalMcpOAuth, waitTimeoutMs: 0 }, { emitSurface: f.emitSurface })).toEqual({ status: 'waiting-for-sign-in' });
  expect(f.showSignIn.mock.calls).toEqual([[{ signInUrl: '/owner/sign-in' }]]);
  expect(f.mcp.applyAccess.mock.calls).toEqual([]);
});

it('MCP sign-in refusal never opens a human card, and unclassified faults propagate unchanged', async () => {
  const f = fixture();
  const externalMcpOAuth = mcpOAuth();
  f.readInstalled.mockResolvedValue({ servers: { main: oauth } });
  const refused = new Error('Provider did not open sign-in.');
  const fault = new Error('Transport unavailable');
  externalMcpOAuth.beginConnect.mockRejectedValueOnce(refused).mockRejectedValueOnce(fault);
  externalMcpOAuth.isSignInRefusal.mockImplementation(({ error }) => error === refused);
  await expect(f.run({ externalMcpOAuth }, { emitSurface: f.emitSurface })).rejects.toThrow('Sign-in not opened: Provider did not open sign-in.');
  await expect(f.run({ externalMcpOAuth }, { emitSurface: f.emitSurface })).rejects.toBe(fault);
  expect(f.host.waitAtSignInCard.mock.calls).toEqual([]);
  expect(externalMcpOAuth.isSignInRefusal.mock.calls).toEqual([[{ error: refused }], [{ error: fault }]]);
});
