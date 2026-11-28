/**
 * @file The shared-connection wiring through in-memory fakes of the host's owner store, bindings,
 * grants and transaction: what `createSharedApiConnections` reads and writes, in which order, and
 * what it refuses when a binding, grant, generation or declaration no longer matches.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ApiConnectionError } from '../errors.js';
import type { ApiConnectionSharedIssuingContext, DeclaredApiConnection } from '../host-ports.js';
import { deriveApiConnectionKey } from '../keys.js';
import type { ApiConnectionService } from '../service.js';
import type { SharedOAuthConnection } from '../shared.js';
import { createSharedApiConnections, type SharedApiConnectionDeps } from '../shared-api.js';

const WORKSPACE = 'ws-1';
const SITE = 'site-a-uuid';
const CREDENTIAL = 'saved-account';
const identity = { pluginId: 'calendar', connectionId: 'account', tokenEndpoint: 'https://issuer.test/token', authorizationEndpoint: 'https://issuer.test/authorize', clientId: 'issuing-client' };
const CONSUMER = deriveApiConnectionKey({ workspaceId: WORKSPACE, pluginId: 'calendar', connectionId: 'account' });

const declared = (over: { tokenEndpoint?: string } = {}) => ({
  pluginId: 'calendar',
  descriptor: { connectionId: 'account', tokenEndpoint: over.tokenEndpoint ?? identity.tokenEndpoint, authorizationEndpoint: identity.authorizationEndpoint },
}) as unknown as DeclaredApiConnection;
const issuingContext = { credentialId: CREDENTIAL, identity } as unknown as ApiConnectionSharedIssuingContext;
const sharedConnection = (over: Partial<SharedOAuthConnection> = {}): SharedOAuthConnection => ({
  credentialId: CREDENTIAL, identity, generation: 1, status: 'connected', account: { accountId: 'alice', displayName: 'Alice' }, grantedScopes: ['calendar.read'], ...over,
});

function setup(options: { siteId?: string; scopes?: string[]; listed?: DeclaredApiConnection[] } = {}) {
  const state = {
    generation: 1 as number | undefined,
    context: issuingContext as ApiConnectionSharedIssuingContext | null,
    connection: sharedConnection() as SharedOAuthConnection | null,
    bindings: new Map<string, string>([[CONSUMER, CREDENTIAL]]),
    attached: new Set<string>([`${SITE}|${CREDENTIAL}`]),
    beforeTransaction: undefined as (() => void) | undefined,
  };
  const log: string[] = [];
  const service = { getAccessToken: vi.fn(async () => 'owner-token'), start: vi.fn(async () => 'started') } as unknown as ApiConnectionService & { getAccessToken: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> };
  const createService = vi.fn((_: unknown) => service);
  const saveContext = vi.fn(async (_: unknown) => { log.push('saveContext'); });
  const deps = {
    workspaceId: WORKSPACE,
    listConnections: async ({ pluginId }: { pluginId: string }) => (options.listed ?? [declared()]).filter((item) => item.pluginId === pluginId),
    requestedScopes: async () => options.scopes ?? ['calendar.read'],
    createService,
    storage: {
      records: { read: async () => (state.generation === undefined ? null : { generation: state.generation }) },
      readContext: async () => state.context,
      readConnection: async () => state.connection,
      saveContext,
      tokensFor: () => { throw new Error('unused'); },
    },
    bindings: {
      read: async ({ consumerId }: { consumerId: string }) => (state.bindings.has(consumerId) ? { credentialId: state.bindings.get(consumerId)! } : null),
      set: async ({ consumerId, credentialId }: { consumerId: string; credentialId: string }) => { log.push(`bind:${consumerId}->${credentialId}`); state.bindings.set(consumerId, credentialId); },
      remove: async ({ consumerId }: { consumerId: string }) => { log.push('unbind'); state.bindings.delete(consumerId); },
    },
    attachments: {
      attach: async ({ siteId, keyId, siteName }: { siteId: string; keyId: string; siteName: string }) => { log.push(`attach:${siteName}`); state.attached.add(`${siteId}|${keyId}`); },
      detach: async ({ siteId, keyId }: { siteId: string; keyId: string }) => { log.push('detach'); state.attached.delete(`${siteId}|${keyId}`); },
      isAttached: async ({ siteId, keyId }: { siteId: string; keyId: string }) => state.attached.has(`${siteId}|${keyId}`),
    },
    transaction: async ({ run }: { run: () => Promise<unknown> }) => { state.beforeTransaction?.(); log.push('tx:begin'); const result = await run(); log.push('tx:end'); return result; },
    siteId: options.siteId ?? SITE,
    siteName: 'Example Site',
    ownerPrincipalId: Promise.resolve('owner-1'),
  } as unknown as SharedApiConnectionDeps & Parameters<typeof createSharedApiConnections>[0];
  return { api: createSharedApiConnections(deps), state, log, service, createService, saveContext };
}

const connection = declared();
const rejectsWith = (promise: Promise<unknown>, code: ApiConnectionError['code']) => expect(promise).rejects.toMatchObject({ name: 'ApiConnectionError', code });

describe('reading and using the shared connection', () => {
  it('serves a token from the owner service for the bound credential, on the project workspace and the frozen account', async () => {
    const { api, service, createService } = setup();
    expect(await api.getAccessToken(connection)).toBe('owner-token');
    expect(service.getAccessToken).toHaveBeenCalledWith({ connectionRef: CREDENTIAL, workspaceId: 'project' }, { expectedAccountId: 'alice' });
    expect(createService).toHaveBeenCalledTimes(1);
    expect(createService.mock.calls[0]![0]).toMatchObject({ connection: expect.objectContaining({ pluginId: 'calendar' }), context: issuingContext });
  });

  it('asks the owner service for no frozen account when the shared connection has no account', async () => {
    const { api, state, service } = setup();
    state.connection = sharedConnection({ account: null });
    expect(await api.getAccessToken(connection)).toBe('owner-token');
    expect(service.getAccessToken).toHaveBeenCalledWith({ connectionRef: CREDENTIAL, workspaceId: 'project' }, {});
  });

  it('reuses the per-credential service across requests instead of rebuilding it', async () => {
    const { api, createService } = setup();
    await api.getAccessToken(connection);
    await api.getAccessToken(connection);
    expect(createService).toHaveBeenCalledTimes(1);
  });

  it('refuses when the owner record moved to another generation than the one just checked', async () => {
    const { api, state, service } = setup();
    state.generation = 2;
    await rejectsWith(api.getAccessToken(connection), 'connection-not-found');
    expect(service.getAccessToken).not.toHaveBeenCalled();
  });

  it('refuses when the sealed issuing context is gone', async () => {
    const { api, state } = setup();
    state.context = null;
    await rejectsWith(api.getAccessToken(connection), 'connection-not-found');
  });

  it('refuses when the live declaration is gone or its endpoints drifted from the issuing identity', async () => {
    await rejectsWith(setup({ listed: [] }).api.getAccessToken(connection), 'connection-not-found');
    await rejectsWith(setup({ listed: [declared({ tokenEndpoint: 'https://evil.test/token' })] }).api.getAccessToken(connection), 'connection-not-found');
  });

  it('requires the site\'s live grant on every use: a binding without an attachment is access-denied', async () => {
    const { api, state, service } = setup();
    state.attached.clear();
    await rejectsWith(api.getAccessToken(connection), 'access-denied');
    expect(service.getAccessToken).not.toHaveBeenCalled();
  });

  it('pins the expected account: another account is account-changed, the same one is served', async () => {
    const { api } = setup();
    await rejectsWith(api.getAccessToken(connection, { expectedAccountId: 'bob' }), 'account-changed');
    expect(await api.getAccessToken(connection, { expectedAccountId: 'alice' })).toBe('owner-token');
  });

  it('reports no binding as null status, false hasBinding and a null account, rather than falling back to anything', async () => {
    const { api, state } = setup();
    expect(await api.hasBinding(connection)).toBe(true);
    state.bindings.clear();
    expect(await api.hasBinding(connection)).toBe(false);
    expect(await api.getStatus(connection)).toBeNull();
    expect(await api.readAccount(connection)).toBeNull();
  });

  it('reads the bound account only while connected', async () => {
    const { api, state } = setup();
    expect(await api.readAccount(connection)).toEqual({ accountId: 'alice', displayName: 'Alice' });
    expect(await api.getStatus(connection)).toMatchObject({ credentialId: CREDENTIAL, status: 'connected', generation: 1 });
    state.connection = sharedConnection({ status: 'reconnect-required' });
    expect(await api.readAccount(connection)).toBeNull();
  });
});

describe('bind', () => {
  it('records the binding for the consumer when the saved connection is connected and compatible', async () => {
    const { api, state, log } = setup();
    state.bindings.clear();
    await api.bind({ keyId: CREDENTIAL, use: true });
    expect(log).toEqual([`bind:${CONSUMER}->${CREDENTIAL}`]);
    expect(state.bindings.get(CONSUMER)).toBe(CREDENTIAL);
  });

  it('with use: false only validates the saved connection\'s declaration and writes nothing', async () => {
    const { api, state, log } = setup();
    state.bindings.clear();
    state.connection = sharedConnection({ status: 'reconnect-required' });
    await expect(api.bind({ keyId: CREDENTIAL, use: false })).resolves.toBeUndefined();
    expect(log).toEqual([]);
    state.context = null;
    await rejectsWith(api.bind({ keyId: CREDENTIAL, use: false }), 'connection-not-found');
  });

  it.each([
    ['the sealed context is missing', (s: ReturnType<typeof setup>) => { s.state.context = null; }, 'connection-not-found'],
    ['the saved connection is not connected', (s: ReturnType<typeof setup>) => { s.state.connection = sharedConnection({ status: 'reconnect-required' }); }, 'connection-not-found'],
    ['the saved connection is gone', (s: ReturnType<typeof setup>) => { s.state.connection = null; }, 'connection-not-found'],
  ])('refuses and binds nothing when %s', async (_name, arrange, code) => {
    const harness = setup();
    harness.state.bindings.clear();
    arrange(harness);
    await rejectsWith(harness.api.bind({ keyId: CREDENTIAL, use: true }), code as ApiConnectionError['code']);
    expect(harness.state.bindings.size).toBe(0);
  });

  it('refuses a saved connection that does not grant the scopes this connection needs, without binding it', async () => {
    const { api, state } = setup({ scopes: ['calendar.write'] });
    state.bindings.clear();
    await rejectsWith(api.bind({ keyId: CREDENTIAL, use: true }), 'scope-not-granted');
    expect(state.bindings.size).toBe(0);
  });
});

describe('leaving the shared connection', () => {
  it('selectLocal drops the site\'s grant and the binding together inside one owner transaction', async () => {
    const { api, state, log } = setup();
    await api.selectLocal(connection);
    expect(log).toEqual(['tx:begin', 'detach', 'unbind', 'tx:end']);
    expect(state.attached.size).toBe(0);
    expect(state.bindings.size).toBe(0);
  });

  it('selectLocal with no binding only clears the (absent) binding and detaches nothing', async () => {
    const { api, state, log } = setup();
    state.bindings.clear();
    await api.selectLocal(connection);
    expect(log).toEqual(['tx:begin', 'unbind', 'tx:end']);
  });

  it('stopUsing removes the grant but keeps the binding, so a later explicit choice can restore access', async () => {
    const { api, state, log } = setup();
    await api.stopUsing(connection);
    expect(log).toEqual(['tx:begin', 'detach', 'tx:end']);
    expect(state.attached.has(`${SITE}|${CREDENTIAL}`)).toBe(false);
    expect(state.bindings.get(CONSUMER)).toBe(CREDENTIAL);
    state.bindings.clear();
    log.length = 0;
    await api.stopUsing(connection);
    expect(log).toEqual(['tx:begin', 'tx:end']);
  });
});

describe('prepare (sign-in for a shared connection)', () => {
  const prepare = (api: ReturnType<typeof setup>['api'], over: { actorId?: string; redirectUri?: string } = {}) =>
    api.prepare({ connection, actorId: over.actorId ?? 'owner-1', context: issuingContext, ...(over.redirectUri === undefined ? {} : { redirectUri: over.redirectUri }) });

  it('refuses anyone but the owner, and an empty site id, before saving or granting anything', async () => {
    const stranger = setup();
    await rejectsWith(prepare(stranger.api, { actorId: 'someone-else' }), 'connection-not-found');
    expect(stranger.saveContext).not.toHaveBeenCalled();
    expect(stranger.log).toEqual([]);
    const noSite = setup({ siteId: '' });
    await rejectsWith(prepare(noSite.api), 'connection-not-found');
    expect(noSite.log).toEqual([]);
  });

  it('refuses a context whose live declaration no longer matches, without saving it', async () => {
    const { api, saveContext, log } = setup({ listed: [declared({ tokenEndpoint: 'https://evil.test/token' })] });
    await rejectsWith(prepare(api), 'connection-not-found');
    expect(saveContext).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });

  it('saves the context, then binds and grants this site under one transaction before the provider round trip', async () => {
    const { api, state, log, createService } = setup();
    state.bindings.clear();
    state.attached.clear();
    const prepared = await prepare(api, { redirectUri: 'https://site.test/callback' });
    expect(log).toEqual(['saveContext', 'tx:begin', `bind:${CONSUMER}->${CREDENTIAL}`, 'attach:Example Site', 'tx:end']);
    expect(prepared.workspaceId).toBe('project');
    expect(createService).toHaveBeenCalledWith({ connection: expect.objectContaining({ pluginId: 'calendar' }), context: issuingContext, redirectUri: 'https://site.test/callback' });
    expect(state.attached.has(`${SITE}|${CREDENTIAL}`)).toBe(true);
  });

  it('omits redirectUri from the service request when none was given', async () => {
    const { api, createService } = setup();
    await prepare(api);
    expect(createService.mock.calls[0]![0]).not.toHaveProperty('redirectUri');
  });

  it('fences the grant: a generation that moved before the transaction is storage-conflict and nothing is bound or attached', async () => {
    const { api, state } = setup();
    state.bindings.clear();
    state.attached.clear();
    state.beforeTransaction = () => { state.generation = 2; };
    await rejectsWith(prepare(api), 'storage-conflict');
    expect(state.bindings.size).toBe(0);
    expect(state.attached.size).toBe(0);
  });

  it('wraps the service so start runs in a transaction after re-checking the generation it was prepared against', async () => {
    const { api, state, service, log } = setup();
    const { service: fenced } = await prepare(api);
    log.length = 0;
    expect(await fenced.start({ marker: 'input' } as never, { marker: 'options' } as never)).toBe('started');
    expect(service.start).toHaveBeenCalledWith({ marker: 'input' }, { marker: 'options' });
    expect(log).toEqual(['tx:begin', 'tx:end']);
    expect(fenced.getAccessToken, 'the rest of the service is passed through').toBe(service.getAccessToken);

    state.generation = 2;
    service.start.mockClear();
    await rejectsWith(fenced.start({} as never), 'storage-conflict');
    expect(service.start).not.toHaveBeenCalled();
  });

  it('treats a credential with no record yet as generation 0, for both preparation and the fence', async () => {
    const { api, state, service } = setup();
    state.generation = undefined;
    const { service: fenced } = await prepare(api);
    await expect(fenced.start({} as never)).resolves.toBe('started');
    expect(service.start).toHaveBeenCalledTimes(1);
  });

  it('onCompleted accepts the sign-in only while this site still uses and is granted the shared connection', async () => {
    const { api, state } = setup();
    const prepared = await prepare(api);
    await expect(prepared.onCompleted()).resolves.toBeUndefined();

    state.bindings.set(CONSUMER, 'another-credential');
    await expect(prepared.onCompleted()).rejects.toMatchObject({ code: 'access-denied', message: expect.stringContaining('stopped using the shared connection while sign-in was open') });

    state.bindings.clear();
    await rejectsWith(prepared.onCompleted(), 'access-denied');
  });

  it('onCompleted never restores a grant that a stop removed while sign-in was open', async () => {
    const { api, state } = setup();
    const prepared = await prepare(api);
    state.attached.clear();
    await rejectsWith(prepared.onCompleted(), 'access-denied');
    expect(state.attached.size, 'a late callback only verifies the grant').toBe(0);
  });

  it('onCompleted refuses a shared connection that is no longer connected', async () => {
    const { api, state } = setup();
    const prepared = await prepare(api);
    state.connection = sharedConnection({ status: 'reconnect-required' });
    await rejectsWith(prepared.onCompleted(), 'reconnect-required');
  });
});
