/**
 * @file Unit tests for serving access tokens: which record states may serve, the frozen-account
 * check, which refresher failures become `reconnect-required`, and that every other failure
 * passes through unchanged. Network-free: tokens are hand-made and never due for refresh unless
 * a test says so.
 */
import { describe, expect, it } from 'vitest';
import { OAuthError } from '@jini-ai/oauth';
import { ApiConnectionError } from '../errors.js';
import { createApiConnectionAccessTokens } from '../access-token.js';
import type { ApiConnectionTokenStore } from '../ports.js';
import { memoryTokenStore } from './fixtures/harness.js';
import type { ApiConnectionRecord } from '../types.js';
import { KEY, connectedRecord, seedRecord, tokens, unitDeps, type UnitDeps } from './fixtures/unit-deps.js';

const owned = { connectionRef: KEY, workspaceId: 'ws-1' };

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => { throw new Error('expected a refusal'); }, (error: unknown) => error);
}

async function served(deps: UnitDeps, optional: { expectedAccountId?: string } = {}) {
  return createApiConnectionAccessTokens(deps).getAccessToken(owned, optional);
}

async function withTokens(over: Partial<ApiConnectionTokenStore> = {}, record = connectedRecord()): Promise<UnitDeps> {
  const store = memoryTokenStore();
  store.entries.set(KEY, tokens('live'));
  const deps = unitDeps({ tokens: { ...store, ...over } });
  await seedRecord(deps, record);
  return deps;
}

describe('serving', () => {
  it('serves the stored access token of a connected record', async () => {
    expect(await served(await withTokens())).toBe('access-live');
  });

  it('serves when the frozen account id still matches', async () => {
    expect(await served(await withTokens(), { expectedAccountId: 'alice' })).toBe('access-live');
  });

  it('refuses a frozen account id when the record has no account', async () => {
    const error = await caught(served(await withTokens({}, connectedRecord({ account: null })), { expectedAccountId: 'alice' }));
    expect(error).toMatchObject({ code: 'account-changed' });
  });
});

describe('records that may not serve', () => {
  it('refuses a reconnect-required record without reading tokens', async () => {
    const deps = await withTokens({ load: async () => { throw new Error('tokens must not be read'); } },
      connectedRecord({ status: 'reconnect-required' }));
    expect(await caught(served(deps))).toMatchObject({ code: 'reconnect-required' });
  });

  it('refuses a revocation-pending record', async () => {
    expect(await caught(served(await withTokens({}, connectedRecord({ status: 'revocation-pending' }))))).toMatchObject({ code: 'revocation-pending' });
  });

  it('refuses a disconnected record as not-connected', async () => {
    expect(await caught(served(await withTokens({}, connectedRecord({ status: 'disconnected' }))))).toMatchObject({ code: 'not-connected' });
  });

  it('refuses a ref from another workspace as connection-not-found', async () => {
    const deps = await withTokens();
    const error = await caught(createApiConnectionAccessTokens(deps).getAccessToken({ connectionRef: KEY, workspaceId: 'ws-2' }));
    expect(error).toMatchObject({ code: 'connection-not-found' });
  });
});

describe('refresher failures', () => {
  it('passes a token-store failure through unchanged', async () => {
    const failure = new Error('vault unavailable');
    expect(await caught(served(await withTokens({ load: async () => { throw failure; } })))).toBe(failure);
  });

  it('passes an OAuth failure other than invalid_grant through unchanged', async () => {
    const failure = new OAuthError({ code: 'OAUTH_PROVIDER_UNREACHABLE', message: 'token endpoint unreachable', operatorAction: 'Retry later.' });
    expect(await caught(served(await withTokens({ load: async () => { throw failure; } })))).toBe(failure);
  });

  it('maps invalid_grant to reconnect-required with the OAuth failure as cause', async () => {
    const failure = new OAuthError({ code: 'OAUTH_INVALID_GRANT', message: 'refresh token rejected', operatorAction: 'Reconnect.' });
    const error = await caught(served(await withTokens({ load: async () => { throw failure; } })));
    expect(error instanceof ApiConnectionError && [error.code, error.cause]).toEqual(['reconnect-required', failure]);
  });

  it('refreshes a due token through the descriptor token endpoint and the injected fetch port only', async () => {
    const urls: string[] = [];
    const store = memoryTokenStore();
    store.entries.set(KEY, tokens('due', { expiresAt: '2026-10-20T09:00:00.000Z' }));
    const deps = unitDeps({ tokens: store, fetchFn: async ({ url }) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ access_token: 'access-renewed', token_type: 'Bearer', expires_in: 3600 }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    } });
    await seedRecord(deps, connectedRecord());
    expect([await served(deps), urls]).toEqual(['access-renewed', ['http://127.0.0.1:9/token']]);
  });

  it('downgrades only a still-connected record when the refresh grant is rejected', async () => {
    const store = memoryTokenStore();
    store.entries.set(KEY, tokens('due', { expiresAt: '2026-10-20T09:00:00.000Z' }));
    const deps = unitDeps({
      tokens: { ...store, markNeedsReauth: async () => {
        // A disconnect lands while the refresh fails: the record must stay as the disconnect left it.
        const current = await deps.records.read({ key: KEY });
        await deps.records.compareAndSet({ key: KEY, expectedRevision: current!.revision,
          record: { ...current!, status: 'revocation-pending', revision: current!.revision + 1 } });
      } },
      fetchFn: async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'content-type': 'application/json' } }),
    });
    await seedRecord(deps, connectedRecord());
    expect(await caught(served(deps))).toMatchObject({ code: 'reconnect-required' });
    expect((await deps.records.read({ key: KEY }))?.status).toBe('revocation-pending');
  });
});

describe('a credential change that lands while the token is read', () => {
  /** A store whose token read lets `change` rewrite the record first, as a concurrent confirm/disconnect would. */
  async function changedDuringRead(change: Partial<ApiConnectionRecord>): Promise<UnitDeps> {
    const store = memoryTokenStore();
    store.entries.set(KEY, tokens('live'));
    const deps: UnitDeps = unitDeps({ tokens: { ...store, load: async args => {
      const current = (await deps.records.read({ key: KEY }))!;
      await deps.records.compareAndSet({ key: KEY, expectedRevision: current.revision,
        record: { ...current, ...change, revision: current.revision + 1 } });
      return store.load(args);
    } } });
    await seedRecord(deps, connectedRecord());
    return deps;
  }

  it('refuses a frozen job when a confirmed switch to another account landed in between', async () => {
    const deps = await changedDuringRead({ generation: 2, account: { accountId: 'bob', displayName: 'Bob' } });
    expect(await caught(served(deps, { expectedAccountId: 'alice' }))).toMatchObject({ code: 'account-changed' });
  });

  it('refuses when a disconnect landed in between', async () => {
    const deps = await changedDuringRead({ generation: 2, status: 'revocation-pending' });
    expect(await caught(served(deps))).toMatchObject({ code: 'revocation-pending' });
  });

  it('refuses with storage-conflict when only the credential generation moved (a reconnect)', async () => {
    const deps = await changedDuringRead({ generation: 2 });
    expect(await caught(served(deps, { expectedAccountId: 'alice' }))).toMatchObject({ code: 'storage-conflict' });
  });
});
