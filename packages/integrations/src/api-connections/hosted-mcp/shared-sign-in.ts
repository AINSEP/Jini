import { randomBytes, randomUUID } from 'node:crypto';
import { ApiConnectionError, assertSharedOAuthCompatibility, createSharedOAuthConsumer, deriveApiConnectionKey, type ApiConnectionClientKind, type ApiConnectionDescriptor,
  type ApiConnectionRecord, type ApiConnectionRecordStore, type ApiConnectionTokenStore, type SharedOAuthConnection } from '../index.js';
import type { OAuthClient, OAuthProviderDescriptor, OAuthTokenSet } from '@jini-ai/core/contracts/oauth';
import type { VaultRecord } from '@jini-ai/core/contracts/vault';
import type { ExternalMcpConnectStart, ExternalMcpServerRecord } from '@jini-ai/core/contracts/hosted-mcp';
import type { ExternalMcpOAuthDeps, ExternalMcpOAuthService, HostedMcpSignInPorts } from './contracts.js';

/** @agent-note Issuing configuration sealed in the owner store; a consuming site's client cannot replace it.
 * Storage MUST losslessly preserve the entire supplied context, including additional fields beyond this base interface.
 * In particular, shared MCP sign-in persists `mcp: { provider: OAuthProviderDescriptor, scopes: readonly string[], url: string | null, grant: string | null }`.
 * `saveContext` must seal those fields and `readContext` must return them unchanged after restart; projecting only the five declared fields breaks device polls and callbacks.
 */
export interface SharedSignInIssuingContext {
  readonly credentialId: string;
  readonly identity: SharedOAuthConnection['identity'];
  readonly client: OAuthClient;
  readonly clientKind: ApiConnectionClientKind;
  readonly descriptor: ApiConnectionDescriptor;
}
/** @agent-note Fulfilled by the host's shared-owner storage over the owner vault: `records` and `tokensFor` use the SAME vault/record store, `saveContext` refuses a changed issuing identity, `readConnection` checks the record against its context. */
export interface SharedSignInOwner {
  readonly records: Pick<ApiConnectionRecordStore, 'read' | 'compareAndSet'>;
  readContext(input: { credentialId: string }): Promise<SharedSignInIssuingContext | null>;
  saveContext(input: { credentialId: string; context: SharedSignInIssuingContext }): Promise<void>;
  tokensFor(input: { context: SharedSignInIssuingContext }): ApiConnectionTokenStore;
  readConnection(input: { credentialId: string }): Promise<SharedOAuthConnection | null>;
}
/** @agent-note Fulfilled by the host's site binding store: token-free consumer→credential references only; a live owner grant still authorizes every use. */
export interface SharedSignInBindings {
  read(input: { consumerId: string }): Promise<{ credentialId: string } | null>;
  set(input: { consumerId: string; credentialId: string }): Promise<void>;
  remove(input: { consumerId: string }): Promise<void>;
}
/** @agent-note Fulfilled by the host's owner-grant attachments: the live owner grant, checked on every use (no cache). */
export interface SharedSignInAttachments {
  attach(required: { siteId: string; keyId: string; siteName: string }): Promise<void>;
  detach(required: { siteId: string; keyId: string }): Promise<void>;
  isAttached(required: { siteId: string; keyId: string }): Promise<boolean>;
}
/** @agent-note The host's owner transaction; binding and attachment writes inside one `run` commit together. Concurrent grant/removal operations must serialize so a completed removal cannot be undone by an older pending grant. */
export type SharedSignInTransaction = <T>(required: { run: () => Promise<T> }) => Promise<T>;

/** @agent-note Host-owned storage and identity for shared sign-in. Owner records and tokens stay in the owner workspace; site bindings contain references only.
 * Persisted protocol identifiers (`external-mcp`, `oauth`, `mcp:` and `shared`) stay stable across restarts and upgrades; they do not select a host workspace.
 */
export interface SharedExternalMcpOwner {
  /** @agent-note The workspace validated by `owner.records` and its vault, also used to derive credential keys. Distinct from the consuming site's workspace. */
  readonly ownerWorkspaceId: string;
  readonly owner: SharedSignInOwner;
  readonly bindings: SharedSignInBindings;
  readonly attachments: SharedSignInAttachments;
  readonly transaction: SharedSignInTransaction;
  readonly siteId: string;
  readonly siteName: string;
  /** @agent-note The authenticated owner identity; the host supplies actor ids from trusted authentication, never model or form input. */
  readonly ownerPrincipalId: string | Promise<string>;
  /** @agent-note Optional bounded owner inventory query; it returns metadata only, never token payloads. */
  readonly inventory?: () => Promise<readonly VaultRecord[]>;
}
export interface SharedMcpConfiguration {
  readonly record: ExternalMcpServerRecord;
  readonly provider: OAuthProviderDescriptor;
  readonly client: OAuthClient;
  readonly scopes: readonly string[];
  readonly resource?: string | undefined;
  readonly issuer?: string | undefined;
}
interface SharedMcpContext extends SharedSignInIssuingContext {
  readonly mcp: { readonly provider: OAuthProviderDescriptor; readonly scopes: readonly string[]; readonly url: string | null; readonly grant: string | null };
}
const MCP_PLUGIN_ID = 'external-mcp';
const consumerId = (serverId: string) => `mcp:${serverId}`;

/** Site-specific bindings over the existing owner vault. Every call checks live grants; no token is copied to the site.
 * @complexity Selected-row reads per call; one cached refresher per selected owner credential, no timers or polling.
 */
export function createSharedExternalMcpOAuth(required: {
  deps: ExternalMcpOAuthDeps<SharedExternalMcpOwner>;
  shared: SharedExternalMcpOwner;
  /** The host's sign-in ports (the same object the sign-in service received). */
  ports: HostedMcpSignInPorts;
  resolveProvider: (record: ExternalMcpServerRecord) => OAuthProviderDescriptor;
  configure: (input: { serverId: string; redirectUri?: string | undefined }) => Promise<SharedMcpConfiguration>;
}, _optional = {}) {
  const { deps, shared, configure, resolveProvider, ports } = required;
  const { owner, bindings, attachments, siteId } = shared;
  const unavailable = () => new ApiConnectionError({ code: 'connection-not-found', message: ports.copy.sharedUnavailable });
  const invalidState = () => ports.errors.oauth({ code: 'OAUTH_INVALID_STATE', message: 'This shared sign-in was stopped or replaced.', operatorAction: ports.copy.actions.restartShared });
  const refreshers = new Map<string, ReturnType<HostedMcpSignInPorts['flow']['createTokenRefresher']>>();
  const deviceKeyFor = (serverId: string, credentialId: string, generation: number) => JSON.stringify(['shared', siteId, serverId, credentialId, generation]);
  const bindingFor = ({ serverId }: { serverId: string }) => bindings.read({ consumerId: consumerId(serverId) });
  async function contextFor(credentialId: string): Promise<SharedMcpContext> {
    const context = await owner.readContext({ credentialId }) as SharedMcpContext | null;
    if (!context?.mcp || context.identity.pluginId !== MCP_PLUGIN_ID || context.identity.connectionId !== 'oauth') throw unavailable();
    return context;
  }
  function optionalAuthorization(authorizationEndpoint: string | undefined) {
    return authorizationEndpoint === undefined ? {} : { authorizationEndpoint };
  }
  function audienceIdentity(endpoints: { resource?: string; issuer?: string }, identity: SharedMcpContext['identity']) {
    const resource = endpoints.resource ?? identity.resource;
    const issuer = endpoints.issuer ?? identity.issuer;
    return { ...(resource === undefined ? {} : { resource }), ...(issuer === undefined ? {} : { issuer }) };
  }
  function endpointIdentity(record: ExternalMcpServerRecord, context: SharedMcpContext) {
    const endpoints = JSON.parse(record.oauthEndpointsJson ?? '{}') as { tokenEndpoint?: string; authorizationEndpoint?: string; resource?: string; issuer?: string };
    const expectedProvider = record.oauthProviderId === null ? undefined : resolveProvider(record);
    return { tokenEndpoint: endpoints.tokenEndpoint ?? expectedProvider?.tokenEndpoint ?? context.identity.tokenEndpoint,
      ...optionalAuthorization(endpoints.authorizationEndpoint ?? expectedProvider?.authorizationEndpoint ?? context.identity.authorizationEndpoint),
      ...audienceIdentity(endpoints, context.identity) };
  }
  function target(record: ExternalMcpServerRecord, context: SharedMcpContext) {
    if (record.authMode !== 'oauth' || record.transport === 'stdio' || record.url !== context.mcp.url) throw unavailable();
    const scopes = JSON.parse(record.oauthScopesJson ?? '[]') as string[];
    return { siteId, consumerId: consumerId(record.serverId), identity: { pluginId: MCP_PLUGIN_ID, connectionId: 'oauth',
      ...endpointIdentity(record, context) }, requiredScopes: scopes };
  }
  async function refreshFor(credentialId: string) {
    const cached = refreshers.get(credentialId);
    if (cached) return cached;
    const context = await contextFor(credentialId);
    const tokens = owner.tokensFor({ context });
    const refresher = ports.flow.createTokenRefresher({ clock: deps.clock, sleep: ({ ms }) => new Promise(resolve => setTimeout(resolve, ms)), port: {
      ...tokens,
      refresh: ({ refreshToken }) => ports.flow.refreshAccessToken({ ...deps.httpPorts, clock: deps.clock, tokenEndpoint: context.identity.tokenEndpoint,
        client: context.client, refreshToken }, { scopes: context.mcp.scopes, ...(context.identity.resource === undefined ? {} : { resource: context.identity.resource }), timeoutMs: 15_000 }),
    } });
    refreshers.set(credentialId, refresher);
    return refresher;
  }
  const consumer = createSharedOAuthConsumer({
    bindings: { read: ({ consumerId }) => bindings.read({ consumerId }) },
    grants: { isGranted: ({ siteId, credentialId }) => attachments.isAttached({ siteId, keyId: credentialId }) },
    connections: { read: input => owner.readConnection(input), getAccessToken: async ({ credentialId, expectedGeneration }) => {
      const record = await owner.records.read({ key: credentialId });
      if (record?.generation !== expectedGeneration || record.status !== 'connected') throw unavailable();
      try { return await (await refreshFor(credentialId)).getAccessToken({ key: credentialId }); }
      catch (error) {
        if (ports.errors.isOAuthError(error) && error.code === 'OAUTH_INVALID_GRANT') {
          await owner.records.compareAndSet({ key: credentialId, expectedRevision: record.revision,
            record: { ...record, status: 'reconnect-required', revision: record.revision + 1 } });
        }
        throw error;
      }
    } },
  });
  async function selected(serverId: string) {
    const binding = await bindingFor({ serverId });
    if (!binding) return null;
    const [context, record] = await Promise.all([contextFor(binding.credentialId), deps.repo.findByServerId({ workspaceId: deps.workspaceId, serverId })]);
    if (!record) throw unavailable();
    return { binding, context, record, target: target(record, context) };
  }
  async function assertAttempt(serverId: string, credentialId: string, generation: number) {
    const [binding, record, granted] = await Promise.all([bindingFor({ serverId }), owner.records.read({ key: credentialId }), attachments.isAttached({ siteId, keyId: credentialId })]);
    if (binding?.credentialId !== credentialId || !granted || !record) throw invalidState();
    if (record.generation !== generation || record.status === 'revocation-pending') throw invalidState();
    return record;
  }
  function stateFor(input: { serverId: string; credentialId: string; generation: number; browserBinding?: string }) {
    const aad = ports.aad.format({ kind: 'oauth-redirect-state', version: 'v1', parts: [JSON.stringify(['shared', siteId, input.serverId, input.credentialId, input.generation, input.browserBinding])] });
    return ports.flow.createSealedAuthorizationState({ clock: deps.clock, workspaceId: siteId, serverId: input.serverId, codec: {
      seal: async ({ plaintext }) => Buffer.from(JSON.stringify(await deps.sealer.seal({ plaintext, key: await deps.keyring.activeKey({}), aad }))).toString('base64url'),
      open: async ({ state }) => deps.sealer.open({ sealed: JSON.parse(Buffer.from(state, 'base64url').toString()) }, { aad }),
    } });
  }
  async function assertOwner(actorId: string | undefined) {
    if (actorId !== await shared.ownerPrincipalId) throw new ApiConnectionError({ code: 'access-denied', message: ports.copy.sharedOwnerOnly });
  }
  async function createSelection(input: { serverId: string; redirectUri?: string }) {
    const server = await deps.repo.findByServerId({ workspaceId: deps.workspaceId, serverId: input.serverId });
    if (!server || server.transport === 'stdio') throw unavailable();
    const config = await configure(input);
    const credentialId = deriveApiConnectionKey({ workspaceId: shared.ownerWorkspaceId, pluginId: MCP_PLUGIN_ID, connectionId: randomUUID() });
    const context: SharedMcpContext = { credentialId, identity: { pluginId: MCP_PLUGIN_ID, connectionId: 'oauth', clientId: config.client.clientId,
      tokenEndpoint: config.provider.tokenEndpoint, ...(config.provider.authorizationEndpoint === undefined ? {} : { authorizationEndpoint: config.provider.authorizationEndpoint }), ...(config.resource === undefined ? {} : { resource: config.resource }), ...(config.issuer === undefined ? {} : { issuer: config.issuer }) },
      client: config.client, clientKind: config.client.authMethod === 'none' ? 'public' : 'confidential', descriptor: { pluginId: MCP_PLUGIN_ID, connectionId: 'oauth', label: config.record.label ?? config.record.serverId,
        authorizationEndpoint: config.provider.authorizationEndpoint ?? config.provider.tokenEndpoint, tokenEndpoint: config.provider.tokenEndpoint,
        authorizationParams: { public: {}, confidential: {} }, forceConsentParams: {}, startParams: [], callbackFields: [] },
      mcp: { provider: config.provider, scopes: config.scopes, url: config.record.url, grant: config.record.oauthGrant } };
    const record: ApiConnectionRecord = { key: credentialId, workspaceId: shared.ownerWorkspaceId, pluginId: MCP_PLUGIN_ID, connectionId: 'oauth', status: 'disconnected',
      revision: 1, generation: 0, account: null, grantedScopes: [], staged: null, revocationFailure: null, updatedAt: new Date(deps.clock.nowMs()).toISOString() };
    await owner.saveContext({ credentialId, context });
    if (!await owner.records.compareAndSet({ key: credentialId, expectedRevision: 0, record })) throw unavailable();
    // Reference first. A partial write confers no authority; a later Stop using here removes the grant before completion.
    await shared.transaction({ run: async () => {
      await bindings.set({ consumerId: consumerId(input.serverId), credentialId });
      await attachments.attach({ siteId, keyId: credentialId, siteName: shared.siteName });
    } });
    return { binding: { credentialId }, context };
  }
  async function install(serverId: string, context: SharedMcpContext, generation: number, tokens: OAuthTokenSet) {
    const grantedScopes = tokens.scopes.length ? tokens.scopes : context.mcp.scopes;
    if (context.mcp.scopes.some(scope => !grantedScopes.includes(scope))) throw unavailable();
    const record = await assertAttempt(serverId, context.credentialId, generation);
    const next = { ...record, revision: record.revision + 1, generation: generation + 1, status: 'connected' as const,
      grantedScopes: [...grantedScopes], updatedAt: new Date(deps.clock.nowMs()).toISOString() };
    if (!await owner.records.compareAndSet({ key: record.key, expectedRevision: record.revision, record: next })) throw invalidState();
    await owner.tokensFor({ context }).install({ key: record.key, tokens: { ...tokens, scopes: [...grantedScopes] }, generation: next.generation });
    await assertAttempt(serverId, context.credentialId, next.generation);
  }
  async function connectionOption(credentialId: string, record: ExternalMcpServerRecord | null) {
    const context = await owner.readContext({ credentialId }) as SharedMcpContext | null;
    if (!context?.mcp || context.mcp.url !== record?.url) return null;
    const connection = await owner.readConnection({ credentialId });
    return connection?.status === 'connected' ? { credentialId, label: context.descriptor.label } : null;
  }
  async function currentSelection(input: { serverId: string }) {
    const current = await bindingFor(input);
    if (!current) return null;
    const connection = await owner.readConnection(current);
    return { ...current, status: connection?.status ?? 'disconnected', granted: await attachments.isAttached({ siteId, keyId: current.credentialId }) };
  }
  return {
    async list(input: { serverId: string; actorId: string }) {
      await assertOwner(input.actorId);
      const rows = await shared.inventory?.() ?? [];
      const candidates = rows.filter(row => row.meta.credentialFormat === 'oauth-token-set').slice(0, 50);
      const record = await deps.repo.findByServerId({ workspaceId: deps.workspaceId, serverId: input.serverId });
      const connections: { credentialId: string; label: string }[] = [];
      for (const row of candidates) {
        const option = await connectionOption(row.id, record);
        if (option) connections.push(option);
      }
      return { available: true, connections, current: await currentSelection(input) };
    },
    hasBinding: async (input: { serverId: string }) => (await bindingFor(input)) !== null,
    async getAccessToken(input: { serverId: string }) {
      const found = await selected(input.serverId);
      return found ? consumer.getAccessToken(found.target) : undefined;
    },
    async assertAuthorized(input: { serverId: string }) {
      const found = await selected(input.serverId);
      if (!found) return false;
      await consumer.assertAuthorized(found.target);
      return true;
    },
    async useSaved(input: { serverId: string; credentialId: string; actorId: string }) {
      await assertOwner(input.actorId);
      const context = await contextFor(input.credentialId);
      const record = await deps.repo.findByServerId({ workspaceId: deps.workspaceId, serverId: input.serverId });
      if (!record) throw unavailable();
      const wanted = target(record, context);
      await shared.transaction({ run: async () => {
        const connection = await owner.readConnection({ credentialId: input.credentialId });
        if (connection?.status !== 'connected') throw unavailable();
        assertSharedOAuthCompatibility({ connection, target: wanted });
        await bindings.set({ consumerId: consumerId(input.serverId), credentialId: input.credentialId });
        await attachments.attach({ siteId, keyId: input.credentialId, siteName: shared.siteName });
      } });
      await consumer.assertAuthorized(wanted);
    },
    async useLocal(input: { serverId: string; actorId: string }) {
      await assertOwner(input.actorId);
      await shared.transaction({ run: async () => {
        const binding = await bindingFor(input);
        if (binding) await attachments.detach({ siteId, keyId: binding.credentialId });
        await bindings.remove({ consumerId: consumerId(input.serverId) });
      } });
    },
    async beginConnect(input: { serverId: string; redirectUri?: string; delivery?: 'hosted'; browserBinding?: string; actorId?: string; destination?: 'shared' }): Promise<ExternalMcpConnectStart> {
      await assertOwner(input.actorId);
      const found = input.destination === 'shared' ? await createSelection(input) : await selected(input.serverId) ?? await createSelection(input);
      const { context, binding } = found;
      const record = await owner.records.read({ key: binding.credentialId });
      if (!record) throw unavailable();
      await assertAttempt(input.serverId, binding.credentialId, record.generation);
      const provider = context.mcp.provider;
      if (context.mcp.grant === 'device_code') {
        const authorization = await ports.flow.beginDeviceAuthorization({ ...deps.httpPorts, provider, clock: deps.clock, client: context.client },
          { scopes: context.mcp.scopes, ...(context.identity.resource === undefined ? {} : { resource: context.identity.resource }), timeoutMs: 15_000 });
        await assertAttempt(input.serverId, binding.credentialId, record.generation);
        await deps.devices.put(deviceKeyFor(input.serverId, binding.credentialId, record.generation), authorization);
        return { kind: 'device_code', userCode: authorization.userCode, verificationUri: authorization.verificationUri,
          verificationUriComplete: authorization.verificationUriComplete, expiresAt: authorization.expiresAt, intervalSeconds: authorization.intervalSeconds };
      }
      if (!input.redirectUri) throw unavailable();
      if (input.delivery === 'hosted') return { kind: 'redirect_required', authorizationUrl: ports.signInLink({ callbackUrl: input.redirectUri,
        workspaceId: deps.workspaceId, serverId: input.serverId }), expiresAt: new Date(deps.clock.nowMs() + 600_000).toISOString() };
      const started = await ports.flow.beginAuthorizationCode({ provider, guard: deps.httpPorts.guard, randomBytesFn: ({ byteLength }) => randomBytes(byteLength),
        stateless: stateFor({ ...input, credentialId: binding.credentialId, generation: record.generation }), ownerKey: JSON.stringify([siteId, input.serverId, binding.credentialId]),
        client: context.client, redirectUri: input.redirectUri, options: { clientDisplayName: ports.registrationIdentity.sharedClientName, softwareId: ports.registrationIdentity.softwareId, redirectUris: [input.redirectUri] } },
      { scopes: context.mcp.scopes, ...(context.identity.resource === undefined ? {} : { resource: context.identity.resource }) });
      return { kind: 'redirect_required', authorizationUrl: started.authorizationUrl, expiresAt: started.expiresAt };
    },
    async completeAuthorizationCallback(input: Parameters<ExternalMcpOAuthService['completeAuthorizationCallback']>[0]) {
      const found = await selected(input.serverId);
      if (!found) throw invalidState();
      const { context, binding } = found;
      const record = await owner.records.read({ key: binding.credentialId });
      if (!record) throw invalidState();
      await assertAttempt(input.serverId, binding.credentialId, record.generation);
      const tokens = await ports.flow.completeAuthorizationCode({ ...deps.httpPorts, provider: context.mcp.provider, clock: deps.clock,
        stateless: stateFor({ ...input, credentialId: binding.credentialId, generation: record.generation }), redirectUri: input.redirectUri,
        ownerKey: JSON.stringify([siteId, input.serverId, binding.credentialId]), client: context.client, params: input.params }, { timeoutMs: 15_000 });
      await install(input.serverId, context, record.generation, tokens);
    },
    async pollDeviceAuthorization(input: { serverId: string }) {
      const found = await selected(input.serverId);
      if (!found) throw invalidState();
      const { context, binding } = found;
      const record = await owner.records.read({ key: binding.credentialId });
      if (!record) throw invalidState();
      await assertAttempt(input.serverId, binding.credentialId, record.generation);
      const deviceKey = deviceKeyFor(input.serverId, binding.credentialId, record.generation);
      const authorization = await deps.devices.get(deviceKey);
      if (!authorization) throw invalidState();
      try {
        const tokens = await ports.flow.pollDeviceAuthorizationOnce({ ...deps.httpPorts, provider: context.mcp.provider, clock: deps.clock,
          client: context.client, deviceCode: authorization.deviceCode, expiresAt: authorization.expiresAt }, { ...(context.identity.resource === undefined ? {} : { resource: context.identity.resource }), timeoutMs: 15_000 });
        await deps.devices.delete(deviceKey);
        await install(input.serverId, context, record.generation, tokens);
        return { status: 'connected' as const };
      } catch (error) {
        if (ports.errors.isOAuthError(error) && error.retryable) return { status: 'pending' as const, retryAfterSeconds: error.retryAfterSeconds ?? authorization.intervalSeconds };
        await deps.devices.delete(deviceKey);
        throw error;
      }
    },
    async markNeedsReauth(input: { serverId: string }) {
      const found = await selected(input.serverId);
      if (!found || !await attachments.isAttached({ siteId, keyId: found.binding.credentialId })) return;
      const record = await owner.records.read({ key: found.binding.credentialId });
      if (record?.status !== 'connected') return;
      await owner.records.compareAndSet({ key: record.key, expectedRevision: record.revision,
        record: { ...record, status: 'reconnect-required', revision: record.revision + 1 } });
    },
    async disconnect(input: { serverId: string }) {
      await shared.transaction({ run: async () => {
        const binding = await bindingFor(input);
        if (binding) await attachments.detach({ siteId, keyId: binding.credentialId });
      } });
    },
  };
}
