/**
 * @file Network-free typed dependencies for API-connection unit tests.
 *
 * Exists so post-exchange rules, access-token serving and account actions can be driven directly
 * with in-memory ports and hand-made token sets, without a fake provider. The fetch port refuses
 * every request, so a unit test that reaches HTTP fails loudly instead of calling out.
 */
import { randomBytes } from 'node:crypto';
import { createOAuthUrlGuard, type OAuthTokenSet } from '@jini-ai/oauth';
import { parseApiConnectionDescriptor, type ApiConnectionHooks, type ApiConnectionServiceDeps } from '../../index.js';
import type { ApiConnectionAccount, ApiConnectionAttempt, ApiConnectionRecord } from '../../types.js';
import { memoryRecordStore, memoryTokenStore } from './harness.js';

export const KEY = 'api-connection:v1:ws-1:acme-office:account';
export const NOW = Date.parse('2026-10-20T10:00:00.000Z');

export type UnitDeps = ApiConnectionServiceDeps & {
  readonly records: ReturnType<typeof memoryRecordStore>;
  readonly clock: { now: number; nowMs(): number };
};

/** Hooks that answer with fixed values and record every revoke. */
export function fixedHooks(account: ApiConnectionAccount = { accountId: 'alice', displayName: 'Alice' }) {
  const revoked: string[] = [];
  const hooks: ApiConnectionHooks = {
    async resolveScopes() { return ['acme.files']; },
    async readAccount() { return account; },
    async revoke({ token }) { revoked.push(token); },
  };
  return { hooks, revoked };
}

export function unitDeps(
  overrides: Partial<Omit<ApiConnectionServiceDeps, 'records' | 'clock'>> & { readonly records?: UnitDeps['records'] } = {},
): UnitDeps {
  const descriptor = parseApiConnectionDescriptor({ value: {
    pluginId: 'acme-office', connectionId: 'account', label: 'Acme account',
    authorizationEndpoint: 'http://127.0.0.1:9/authorize', tokenEndpoint: 'http://127.0.0.1:9/token',
  } });
  return {
    descriptor, clientKind: 'public', client: { clientId: 'acme-desktop', authMethod: 'none' },
    appOptions: { clientDisplayName: 'Test host', softwareId: 'test-host', redirectUris: ['http://127.0.0.1:47011/callback'] },
    hooks: fixedHooks().hooks, records: memoryRecordStore(), tokens: memoryTokenStore(),
    fetchFn: async ({ url }) => { throw new Error(`unit test fetch refused ${String(url)}`); },
    guard: createOAuthUrlGuard({ assertAllowed: () => undefined }, { allowLoopbackHttp: true }),
    clock: { now: NOW, nowMs() { return this.now; } },
    randomBytesFn: ({ byteLength }) => randomBytes(byteLength), sleep: async () => undefined,
    ...overrides,
  };
}

export function tokens(label: string, over: Partial<OAuthTokenSet> = {}): OAuthTokenSet {
  return { accessToken: `access-${label}`, refreshToken: `refresh-${label}`, tokenType: 'Bearer', scopes: ['acme.files'],
    expiresAt: '2026-10-20T11:00:00.000Z', ...over };
}

export function attempt(over: Partial<ApiConnectionAttempt> = {}): ApiConnectionAttempt {
  return { state: 'state-1', attemptId: 'attempt-1', key: KEY, ownerKey: '["ws-1","actor-1","acme-office","account"]',
    workspaceId: 'ws-1', actorId: 'actor-1', pluginId: 'acme-office', connectionId: 'account', intent: 'connect',
    requestedScopes: ['acme.files'], redirectUri: 'http://127.0.0.1:47011/callback', generation: 0, codeVerifier: 'verifier-1',
    createdAt: '2026-10-20T10:00:00.000Z', expiresAt: '2026-10-20T10:10:00.000Z', ...over };
}

export function connectedRecord(over: Partial<ApiConnectionRecord> = {}): ApiConnectionRecord {
  return { key: KEY, workspaceId: 'ws-1', pluginId: 'acme-office', connectionId: 'account', status: 'connected', revision: 1,
    generation: 1, account: { accountId: 'alice', displayName: 'Alice' }, grantedScopes: ['acme.files'], staged: null,
    updatedAt: '2026-10-20T10:00:00.000Z', ...over };
}

/** Store `record` as the first write for its key. */
export async function seedRecord(deps: UnitDeps, record: ApiConnectionRecord): Promise<void> {
  if (!await deps.records.compareAndSet({ key: record.key, expectedRevision: 0, record: { ...record, revision: 1 } })) {
    throw new Error('fixture could not seed the record');
  }
}
