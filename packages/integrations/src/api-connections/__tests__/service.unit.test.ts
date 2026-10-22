/**
 * @file Unit tests for the composition root and the status view: wiring is refused once at
 * construction when the client kind is unknown or contradicts the client, and the status a host
 * renders carries account, scopes and a pending switch but never a path back to a credential.
 */
import { describe, expect, it } from 'vitest';
import { ApiConnectionError, createApiConnectionService, type ApiConnectionClientKind } from '../index.js';
import { OAuthTokenStoreError } from '../token-store/errors.js';
import { memoryTokenStore } from './fixtures/harness.js';
import { KEY, connectedRecord, seedRecord, tokens, unitDeps } from './fixtures/unit-deps.js';

function wiringRefusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiConnectionError) return error.code;
    throw error;
  }
  throw new Error('expected a wiring refusal');
}

describe('createApiConnectionService wiring', () => {
  it('refuses a client kind it does not know', () => {
    // Malformed input on purpose: hosts read the client kind from configuration.
    const deps = unitDeps({ clientKind: 'hosted' as ApiConnectionClientKind });
    expect(wiringRefusal(() => createApiConnectionService(deps))).toBe('configuration-invalid');
  });

  it('accepts a confidential client that authenticates at the token endpoint', () => {
    const deps = unitDeps({ clientKind: 'confidential', client: { clientId: 'acme-web', clientSecret: 'web-secret', authMethod: 'client_secret_basic' } });
    expect(typeof createApiConnectionService(deps).start).toBe('function');
  });

  it('accepts a public client without a secret', () => {
    expect(typeof createApiConnectionService(unitDeps()).getAccessToken).toBe('function');
  });
});

describe('status', () => {
  it('reads a never-created connection as disconnected', async () => {
    const status = await createApiConnectionService(unitDeps()).getStatus({ connectionRef: KEY, workspaceId: 'ws-1' });
    expect(status).toEqual({ connectionRef: KEY, status: 'disconnected', account: null, grantedScopes: [], pendingSwitch: null,
      revocationFailure: null });
  });

  it('does not read credentials for a never-created connection', async () => {
    const deps = unitDeps({ tokens: { ...memoryTokenStore(), load: async () => { throw new Error('must not read tokens'); } } });
    expect((await createApiConnectionService(deps).getStatus({ connectionRef: KEY, workspaceId: 'ws-1' })).status).toBe('disconnected');
  });

  it.each(['invalid-record', 'owner-mismatch'] as const)('shows %s as reconnect-required without changing the stored data', async code => {
    const store = memoryTokenStore();
    store.entries.set(KEY, tokens('legacy'));
    const deps = unitDeps({ tokens: { ...store, load: async () => { throw new OAuthTokenStoreError({ code }); } } });
    await seedRecord(deps, connectedRecord());
    const before = await deps.records.read({ key: KEY });
    expect(await createApiConnectionService(deps).getStatus({ connectionRef: KEY, workspaceId: 'ws-1' })).toEqual({
      connectionRef: KEY, status: 'reconnect-required', account: { accountId: 'alice', displayName: 'Alice' },
      grantedScopes: ['acme.files'], pendingSwitch: null, revocationFailure: null,
    });
    expect(await deps.records.read({ key: KEY })).toEqual(before);
    expect(store.entries.get(KEY)).toEqual(tokens('legacy'));
  });

  it('shows a connected record with no usable tokens as reconnect-required', async () => {
    const deps = unitDeps();
    await seedRecord(deps, connectedRecord());
    expect((await createApiConnectionService(deps).getStatus({ connectionRef: KEY, workspaceId: 'ws-1' })).status).toBe('reconnect-required');
  });

  it('passes vault outages through instead of calling them reconnect-required', async () => {
    const failure = new Error('vault unavailable');
    const deps = unitDeps({ tokens: { ...memoryTokenStore(), load: async () => { throw failure; } } });
    await seedRecord(deps, connectedRecord());
    await expect(createApiConnectionService(deps).getStatus({ connectionRef: KEY, workspaceId: 'ws-1' })).rejects.toBe(failure);
  });

  it('shows the staged account as the pending switch', async () => {
    const deps = unitDeps();
    await seedRecord(deps, connectedRecord({ staged: { account: { accountId: 'bob', displayName: 'Bob' }, grantedScopes: ['acme.files'],
      actorId: 'actor-1', generation: 1, expiresAt: '2026-10-20T10:10:00.000Z' } }));
    const status = await createApiConnectionService(deps).getStatus({ connectionRef: KEY, workspaceId: 'ws-1' });
    expect(status.pendingSwitch).toEqual({ accountId: 'bob', displayName: 'Bob' });
  });

  it('refuses a ref of another workspace', async () => {
    const deps = unitDeps();
    await seedRecord(deps, connectedRecord());
    const error = await createApiConnectionService(deps).getStatus({ connectionRef: KEY, workspaceId: 'ws-2' })
      .then(() => null, (caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'connection-not-found' });
  });

  it('carries no token material even when tokens are stored', async () => {
    const store = memoryTokenStore();
    store.entries.set(KEY, tokens('alice'));
    const deps = unitDeps({ tokens: store });
    await seedRecord(deps, connectedRecord());
    const status = JSON.stringify(await createApiConnectionService(deps).getStatus({ connectionRef: KEY, workspaceId: 'ws-1' }));
    expect([status.includes('access-alice'), status.includes('refresh-alice'), status.includes('generation')]).toEqual([false, false, false]);
  });
});
