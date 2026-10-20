/**
 * @file Unit tests for account actions: when a staged switch may be confirmed, what a cancel or
 * disconnect reports for each revocation outcome, and which records each action may touch.
 * Network-free: the revoke hook is a typed fake.
 */
import { describe, expect, it } from 'vitest';
import { cancelSwitchAccount, confirmSwitchAccount, disconnectApiConnection } from '../account-actions.js';
import { stagedTokenKey } from '../keys.js';
import { OAuthTokenStoreError } from '../token-store/errors.js';
import { getApiConnectionStatus } from '../status.js';
import type { ApiConnectionRecord, ApiConnectionStagedSwitch } from '../types.js';
import { memoryTokenStore } from './fixtures/harness.js';
import { KEY, connectedRecord, fixedHooks, seedRecord, tokens, unitDeps } from './fixtures/unit-deps.js';

const STAGED_KEY = stagedTokenKey({ key: KEY });
const owned = { connectionRef: KEY, workspaceId: 'ws-1' };

function staged(over: Partial<ApiConnectionStagedSwitch> = {}): ApiConnectionStagedSwitch {
  return { account: { accountId: 'bob', displayName: 'Bob' }, grantedScopes: ['acme.files'], actorId: 'actor-1', generation: 1,
    expiresAt: '2026-10-20T10:10:00.000Z', ...over };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => { throw new Error('expected a refusal'); }, (error: unknown) => error);
}

async function stagedDeps(stagedOver: Partial<ApiConnectionStagedSwitch> = {}) {
  const store = memoryTokenStore();
  store.entries.set(KEY, tokens('alice'));
  store.entries.set(STAGED_KEY, tokens('bob'));
  const { hooks, revoked } = fixedHooks();
  const deps = unitDeps({ tokens: store, hooks });
  await seedRecord(deps, connectedRecord({ staged: staged(stagedOver) }));
  return { deps, store, revoked };
}

describe('confirmSwitchAccount', () => {
  it('installs the staged account and removes the staged copy', async () => {
    const { deps, store } = await stagedDeps();
    const view = await confirmSwitchAccount(deps, { ...owned, actorId: 'actor-1' });
    expect([view.account, view.pendingSwitch, store.entries.get(KEY)?.accessToken, store.entries.has(STAGED_KEY)])
      .toEqual([{ accountId: 'bob', displayName: 'Bob' }, null, 'access-bob', false]);
  });

  it('refuses when the staged tokens are gone, leaving the live account', async () => {
    const { deps, store } = await stagedDeps();
    store.entries.delete(STAGED_KEY);
    expect(await caught(confirmSwitchAccount(deps, { ...owned, actorId: 'actor-1' }))).toMatchObject({ code: 'switch-not-staged' });
    expect((await deps.records.read({ key: KEY }))?.account?.accountId).toBe('alice');
  });

  it('refuses a staged switch at its expiry time', async () => {
    const { deps } = await stagedDeps();
    deps.clock.now = Date.parse('2026-10-20T10:10:00.000Z');
    expect(await caught(confirmSwitchAccount(deps, { ...owned, actorId: 'actor-1' }))).toMatchObject({ code: 'switch-not-staged' });
  });

  it('refuses a switch staged against an older credential generation', async () => {
    const { deps } = await stagedDeps({ generation: 0 });
    expect(await caught(confirmSwitchAccount(deps, { ...owned, actorId: 'actor-1' }))).toMatchObject({ code: 'switch-not-staged' });
  });

  it('refuses when nothing is staged', async () => {
    const deps = unitDeps();
    await seedRecord(deps, connectedRecord());
    expect(await caught(confirmSwitchAccount(deps, { ...owned, actorId: 'actor-1' }))).toMatchObject({ code: 'switch-not-staged' });
  });
});

describe('cancelSwitchAccount', () => {
  it('revokes the staged grant, clears the staged slot and reports confirmed', async () => {
    const { deps, revoked } = await stagedDeps();
    const result = await cancelSwitchAccount(deps, owned);
    expect([result.remoteRevocation, result.pendingSwitch, revoked]).toEqual(['confirmed', null, ['refresh-bob']]);
  });

  it('clears the staged slot and reports not-needed when the staged tokens are already gone', async () => {
    const { deps, store, revoked } = await stagedDeps();
    store.entries.delete(STAGED_KEY);
    const result = await cancelSwitchAccount(deps, owned);
    expect([result.remoteRevocation, result.pendingSwitch, revoked]).toEqual(['not-needed', null, []]);
  });

  it('removes an unreadable staged credential and reports pending, never confirmed', async () => {
    const { deps, store } = await stagedDeps();
    const unreadable = { ...store, loadForRevocation: async () => { throw new OAuthTokenStoreError({ code: 'owner-mismatch' }); } };
    const result = await cancelSwitchAccount({ ...deps, tokens: unreadable }, owned);
    expect([result.remoteRevocation, result.pendingSwitch, store.entries.has(STAGED_KEY)]).toEqual(['pending', null, false]);
  });
});

describe('disconnectApiConnection', () => {
  it('reports not-needed and ends disconnected when no credential is stored', async () => {
    const deps = unitDeps();
    await seedRecord(deps, connectedRecord());
    const result = await disconnectApiConnection(deps, owned);
    expect([result.status, result.account, result.grantedScopes, result.remoteRevocation]).toEqual(['disconnected', null, [], 'not-needed']);
  });

  it('revokes with the access token when the stored credential has no refresh token', async () => {
    const store = memoryTokenStore();
    store.entries.set(KEY, tokens('alice', { refreshToken: null }));
    const { hooks, revoked } = fixedHooks();
    const deps = unitDeps({ tokens: store, hooks });
    await seedRecord(deps, connectedRecord());
    const result = await disconnectApiConnection(deps, owned);
    expect([result.remoteRevocation, revoked]).toEqual(['confirmed', ['access-alice']]);
  });

  it('moves the credential generation before revoking, so no token is served during the network call', async () => {
    const generations: number[] = [];
    const deps = unitDeps({ tokens: { ...memoryTokenStore(), loadForRevocation: async () => {
      generations.push((await deps.records.read({ key: KEY }))!.generation);
      return tokens('alice');
    } } });
    await seedRecord(deps, connectedRecord({ generation: 3 }));
    await disconnectApiConnection(deps, owned);
    expect(generations).toEqual([4, 4]);
  });

  it('retries a pending revocation without moving the generation again', async () => {
    const store = memoryTokenStore();
    store.entries.set(KEY, tokens('alice'));
    const deps = unitDeps({ tokens: store, hooks: { ...fixedHooks().hooks, revoke: async () => { throw new Error('provider down'); } } });
    await seedRecord(deps, connectedRecord({ status: 'revocation-pending', generation: 5 }));
    const result = await disconnectApiConnection(deps, owned);
    expect([result.status, result.remoteRevocation, (await deps.records.read({ key: KEY }))?.generation]).toEqual(['revocation-pending', 'pending', 5]);
  });

  it('reports pending but ends disconnected when the live credential was unreadable and the staged one confirmed', async () => {
    const store = memoryTokenStore();
    store.entries.set(STAGED_KEY, tokens('bob'));
    const deps = unitDeps({ tokens: { ...store, loadForRevocation: async ({ key }) => {
      if (key === KEY) throw new OAuthTokenStoreError({ code: 'invalid-record' });
      return store.loadForRevocation({ key });
    } } });
    await seedRecord(deps, connectedRecord({ staged: staged() }));
    const result = await disconnectApiConnection(deps, owned);
    expect([result.status, result.remoteRevocation, store.entries.size]).toEqual(['disconnected', 'pending', 0]);
  });

  it('refuses a record of another plugin connection without touching it', async () => {
    const deps = unitDeps();
    await seedRecord(deps, connectedRecord({ pluginId: 'other-plugin' }));
    expect(await caught(disconnectApiConnection(deps, owned))).toMatchObject({ code: 'connection-not-found' });
    expect((await deps.records.read({ key: KEY }))?.revision).toBe(1);
  });
});

describe('revocation failure diagnostics (a fixed code, never the hook or provider text)', () => {
  /** A connected record with live tokens whose revoke hook throws `error`. */
  async function failingRevoke(error: unknown, record = connectedRecord()) {
    const store = memoryTokenStore();
    store.entries.set(KEY, tokens('alice'));
    store.entries.set(STAGED_KEY, tokens('bob'));
    let failure: unknown = error;
    const deps = unitDeps({ tokens: store, hooks: { ...fixedHooks().hooks, revoke: async () => { if (failure !== null) throw failure; } } });
    await seedRecord(deps, record);
    return { deps, succeedNext: () => { failure = null; } };
  }
  const providerError = (code: string) => Object.assign(new Error(`provider said ${'x'.repeat(8)}`), { code });

  it('records the hook classification provider-unreachable on the record and the status view', async () => {
    const { deps } = await failingRevoke(providerError('provider-unreachable'));
    const result = await disconnectApiConnection(deps, owned);
    expect([result.revocationFailure, (await deps.records.read({ key: KEY }))?.revocationFailure])
      .toEqual(['provider-unreachable', 'provider-unreachable']);
  });

  it('records provider-refused when the hook classifies the failure so', async () => {
    const { deps } = await failingRevoke(providerError('provider-refused'));
    expect((await disconnectApiConnection(deps, owned)).revocationFailure).toBe('provider-refused');
  });

  it('records unclassified for any other code and keeps the hook message out of the record', async () => {
    const { deps } = await failingRevoke(providerError('E_SOMETHING'));
    const result = await disconnectApiConnection(deps, owned);
    const stored = JSON.stringify(await deps.records.read({ key: KEY }));
    expect([result.revocationFailure, stored.includes('provider said'), stored.includes('E_SOMETHING')]).toEqual(['unclassified', false, false]);
  });

  it('records unclassified when the hook throws undefined', async () => {
    const { deps } = await failingRevoke(undefined);
    expect((await disconnectApiConnection(deps, owned)).revocationFailure).toBe('unclassified');
  });

  it('clears the diagnostic once a retried disconnect is confirmed', async () => {
    const { deps, succeedNext } = await failingRevoke(providerError('provider-unreachable'));
    await disconnectApiConnection(deps, owned);
    succeedNext();
    const result = await disconnectApiConnection(deps, owned);
    expect([result.status, result.remoteRevocation, result.revocationFailure]).toEqual(['disconnected', 'confirmed', null]);
  });

  it('records credential-unreadable when the stored credential could not be read and was removed locally', async () => {
    const store = memoryTokenStore();
    const deps = unitDeps({ tokens: { ...store, loadForRevocation: async () => { throw new OAuthTokenStoreError({ code: 'invalid-record' }); } } });
    await seedRecord(deps, connectedRecord());
    const result = await disconnectApiConnection(deps, owned);
    expect([result.status, result.remoteRevocation, result.revocationFailure]).toEqual(['disconnected', 'pending', 'credential-unreadable']);
  });

  it('records the failure of a cancelled switch and keeps the switch staged', async () => {
    const { deps } = await failingRevoke(providerError('provider-refused'), connectedRecord({ staged: staged() }));
    const result = await cancelSwitchAccount(deps, owned);
    expect([result.remoteRevocation, result.pendingSwitch?.accountId, result.revocationFailure]).toEqual(['pending', 'bob', 'provider-refused']);
  });

  it('clears a cancelled switch failure when the switch is then confirmed', async () => {
    const { deps } = await failingRevoke(providerError('provider-refused'), connectedRecord({ staged: staged() }));
    await cancelSwitchAccount(deps, owned);
    expect((await confirmSwitchAccount(deps, { ...owned, actorId: 'actor-1' })).revocationFailure).toBeNull();
  });

  it('reads a record stored before the diagnostic existed as having none', async () => {
    const deps = unitDeps();
    const { revocationFailure: _dropped, ...legacy } = connectedRecord();
    // Malformed on purpose: a row written by an older engine has no revocationFailure field.
    await seedRecord(deps, legacy as ApiConnectionRecord);
    expect((await getApiConnectionStatus(deps, owned)).revocationFailure).toBeNull();
  });
});
