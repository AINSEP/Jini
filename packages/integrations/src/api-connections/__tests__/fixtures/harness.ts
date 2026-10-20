/**
 * @file Typed in-memory ports and an acme plugin wiring for API-connection tests.
 *
 * Exists so every test builds a real service over the same fakes. The fetch port refuses every
 * host but the local fake provider, so no test can reach a real third party.
 */
import { randomBytes } from 'node:crypto';
import { createOAuthUrlGuard, type OAuthClient, type OAuthFetch, type OAuthTokenSet } from '@jini-ai/oauth';
import { AesGcmSecretSealer } from '@jini-ai/platform/secrets';
import { InMemoryKeyring } from '@jini-ai/platform/secrets/testing';
import { InMemoryVaultRepo, SecretsVaultService, createVaultMetaParsers } from '@jini-ai/platform/secrets/credential-sets';
import { createApiConnectionGenerationReader, createApiConnectionService, createVaultOAuthTokenStore, parseApiConnectionDescriptor,
  parseOAuthTokenVaultMeta, type ApiConnectionHooks, type ApiConnectionRecordStore, type ApiConnectionService,
  type ApiConnectionTokenStore, type VaultOAuthTokenStore } from '../../index.js';
import type { ApiConnectionAttempt, ApiConnectionIntent, ApiConnectionRecord } from '../../types.js';
import type { AcmeProvider } from './acme-provider.js';

export const CALLBACK = 'http://127.0.0.1:47011/callback';

export function memoryRecordStore(): ApiConnectionRecordStore & { attempts: Map<string, ApiConnectionAttempt> } {
  const records = new Map<string, ApiConnectionRecord>();
  const attempts = new Map<string, ApiConnectionAttempt>();
  return {
    attempts,
    async read({ key }) { return structuredClone(records.get(key) ?? null); },
    async compareAndSet({ key, expectedRevision, record }) {
      if ((records.get(key)?.revision ?? 0) !== expectedRevision) return false;
      records.set(key, structuredClone(record));
      return true;
    },
    async putAttempt({ attempt }) { attempts.set(attempt.state, structuredClone(attempt)); },
    async takeAttempt({ state }) {
      const attempt = attempts.get(state) ?? null;
      attempts.delete(state);
      return attempt;
    },
  };
}

export function memoryTokenStore(): ApiConnectionTokenStore & { entries: Map<string, OAuthTokenSet> } {
  const entries = new Map<string, OAuthTokenSet>();
  return {
    entries,
    async load({ key }) { return structuredClone(entries.get(key) ?? null); },
    async loadForRevocation({ key }) { return structuredClone(entries.get(key) ?? null); },
    async persist({ key, tokens }) { entries.set(key, structuredClone(tokens)); },
    async install({ key, tokens }) { entries.set(key, structuredClone(tokens)); },
    async markNeedsReauth() { /* status lives in the record store */ },
    async delete({ key }) { entries.delete(key); },
  };
}

export function acmeHooks(provider: AcmeProvider): ApiConnectionHooks {
  const sets: Record<string, string[]> = { files: ['acme.files'], mail: ['acme.mail'] };
  return {
    async resolveScopes({ scopeSetIds }) { return scopeSetIds.flatMap(id => sets[id] ?? []); },
    async readAccount({ accessToken }) {
      const response = await fetch(`${provider.origin}/userinfo`, { headers: { authorization: `Bearer ${accessToken}` } });
      const body = await response.json() as { id: string; name: string };
      return { accountId: body.id, displayName: body.name };
    },
    async revoke({ token }) {
      const response = await fetch(`${provider.origin}/revoke`, { method: 'POST', body: new URLSearchParams({ token }) });
      if (!response.ok) throw new Error(`revocation refused (${response.status})`);
    },
  };
}

export interface Harness<Tokens extends ApiConnectionTokenStore = ReturnType<typeof memoryTokenStore>> {
  service: ApiConnectionService;
  records: ReturnType<typeof memoryRecordStore>;
  tokens: Tokens;
  clock: { now: number; nowMs(): number };
}

interface HarnessOptions { client?: OAuthClient; clientKind?: 'public' | 'confidential'; pluginId?: string }

function buildWith<Tokens extends ApiConnectionTokenStore>(provider: AcmeProvider, options: HarnessOptions,
  makeTokens: (required: { records: ApiConnectionRecordStore; clock: Harness['clock'] }) => Tokens): Harness<Tokens> {
  const { client = { clientId: 'acme-desktop', authMethod: 'none' } as OAuthClient, clientKind = 'public', pluginId = 'acme-office' } = options;
  const descriptor = parseApiConnectionDescriptor({ value: {
    pluginId, connectionId: 'account', label: 'Acme account',
    authorizationEndpoint: `${provider.origin}/authorize`, tokenEndpoint: `${provider.origin}/token`,
    authorizationParams: { public: { prompt: 'consent' }, confidential: { include_granted: 'true' } },
    startParams: [{ name: 'pick_mode', maxLength: 8 }],
    callbackFields: [{ name: 'picked', maxLength: 64 }],
  } });
  const fetchFn: OAuthFetch = ({ url }, init) => {
    if (!String(url).startsWith(provider.origin)) throw new Error(`test fetch refused ${String(url)}`);
    return fetch(url, init);
  };
  const clock = { now: Date.parse('2026-10-20T10:00:00.000Z'), nowMs() { return this.now; } };
  const records = memoryRecordStore();
  const tokens = makeTokens({ records, clock });
  const service = createApiConnectionService({
    descriptor, client, clientKind, hooks: acmeHooks(provider), records, tokens, fetchFn, clock,
    appOptions: { clientDisplayName: 'Test host', softwareId: 'test-host', redirectUris: [CALLBACK] },
    guard: createOAuthUrlGuard({ assertAllowed: () => undefined }, { allowLoopbackHttp: true }),
    randomBytesFn: ({ byteLength }) => randomBytes(byteLength), sleep: async () => undefined,
  });
  return { service, records, tokens, clock };
}

export function buildHarness(provider: AcmeProvider, options: HarnessOptions = {}): Harness {
  return buildWith(provider, options, () => memoryTokenStore());
}

/** The same service over the real vault-backed token store (real sealing, lease and generation fencing). */
export function buildVaultHarness(provider: AcmeProvider, options: HarnessOptions = {}): Harness<VaultOAuthTokenStore> {
  const repo = new InMemoryVaultRepo({});
  const keyring = new InMemoryKeyring({ hkdfSalt: 'api-connection-tests' });
  const vault = new SecretsVaultService({ repo, keyring, sealer: new AesGcmSecretSealer({ keyring }),
    metaParsers: createVaultMetaParsers({}, { parsers: { 'mcp-auth': parseOAuthTokenVaultMeta } }),
    authorize: async () => {}, now: () => '2026-10-20T10:00:00.000Z', newId: () => 'unused-id' });
  return buildWith(provider, options, ({ records, clock }) => createVaultOAuthTokenStore({
    vault, clock, readGeneration: createApiConnectionGenerationReader({ records }),
    vaultScope: { workspaceId: 'ws-1', kind: 'mcp-auth', ownerKey: 'acme-office', principalId: null, binding: null },
    owner: { workspaceId: 'ws-1', pluginId: options.pluginId ?? 'acme-office', connectionId: 'account',
      clientId: options.client?.clientId ?? 'acme-desktop' },
  }));
}

/** Start a connect for `actor` in workspace ws-1 and approve it at the fake provider. */
export async function signIn(h: Harness<ApiConnectionTokenStore>, provider: AcmeProvider, { account = 'alice', actorId = 'actor-1', intent = 'connect' as ApiConnectionIntent,
  grantScopes = undefined as string[] | undefined, omitRefreshToken = false } = {}) {
  const started = await h.service.start({ workspaceId: 'ws-1', actorId, intent, scopeSetIds: ['files'], redirectUri: CALLBACK });
  const callbackParams = provider.approve({ authorizationUrl: started.authorizationUrl, account, omitRefreshToken,
    ...(grantScopes ? { grantScopes } : {}) });
  return { started, callbackParams };
}
