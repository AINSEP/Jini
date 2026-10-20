/**
 * @file Typed in-memory ports and an acme plugin wiring for API-connection tests.
 *
 * Exists so every test builds a real service over the same fakes. The fetch port refuses every
 * host but the local fake provider, so no test can reach a real third party.
 */
import { randomBytes } from 'node:crypto';
import { createOAuthUrlGuard, type OAuthClient, type OAuthFetch, type OAuthTokenSet } from '@jini-ai/oauth';
import { createApiConnectionService, parseApiConnectionDescriptor, type ApiConnectionHooks, type ApiConnectionRecordStore,
  type ApiConnectionService, type ApiConnectionTokenStore } from '../../index.js';
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
    async persist({ key, tokens }) { entries.set(key, structuredClone(tokens)); },
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

export interface Harness {
  service: ApiConnectionService;
  records: ReturnType<typeof memoryRecordStore>;
  tokens: ReturnType<typeof memoryTokenStore>;
  clock: { now: number; nowMs(): number };
}

export function buildHarness(provider: AcmeProvider, { client = { clientId: 'acme-desktop', authMethod: 'none' } as OAuthClient,
  pluginId = 'acme-office' } = {}): Harness {
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
  const tokens = memoryTokenStore();
  const service = createApiConnectionService({
    descriptor, client, hooks: acmeHooks(provider), records, tokens, fetchFn, clock,
    appOptions: { clientDisplayName: 'Test host', softwareId: 'test-host', redirectUris: [CALLBACK] },
    guard: createOAuthUrlGuard({ assertAllowed: () => undefined }, { allowLoopbackHttp: true }),
    randomBytesFn: ({ byteLength }) => randomBytes(byteLength), sleep: async () => undefined,
  });
  return { service, records, tokens, clock };
}

/** Start a connect for `actor` in workspace ws-1 and approve it at the fake provider. */
export async function signIn(h: Harness, provider: AcmeProvider, { account = 'alice', actorId = 'actor-1', intent = 'connect' as ApiConnectionIntent,
  grantScopes = undefined as string[] | undefined, omitRefreshToken = false } = {}) {
  const started = await h.service.start({ workspaceId: 'ws-1', actorId, intent, scopeSetIds: ['files'], redirectUri: CALLBACK });
  const callbackParams = provider.approve({ authorizationUrl: started.authorizationUrl, account, omitRefreshToken,
    ...(grantScopes ? { grantScopes } : {}) });
  return { started, callbackParams };
}
