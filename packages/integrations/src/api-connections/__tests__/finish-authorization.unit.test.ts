/**
 * @file Unit tests for `finishAuthorization`, the post-exchange rules: granted scopes, the
 * plugin identity hook's answer, generation and staged-switch fencing, refresh-token keeping and
 * renewability. Driven directly with hand-made token sets over network-free typed ports.
 */
import { describe, expect, it } from 'vitest';
import type { ApiConnectionAccount } from '../types.js';
import { ApiConnectionError } from '../errors.js';
import { finishAuthorization } from '../finish-authorization.js';
import { stagedTokenKey } from '../keys.js';
import { OAuthTokenStoreError } from '../token-store/errors.js';
import { KEY, attempt, connectedRecord, fixedHooks, seedRecord, tokens, unitDeps, type UnitDeps } from './fixtures/unit-deps.js';
import { memoryTokenStore } from './fixtures/harness.js';

async function refusal(promise: Promise<unknown>): Promise<ApiConnectionError> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  if (error instanceof ApiConnectionError) return error;
  throw new Error(`expected an ApiConnectionError, got ${String(error)}`);
}

const finish = (deps: UnitDeps, over: Parameters<typeof attempt>[0] = {}, set = tokens('new')) =>
  finishAuthorization(deps, { attempt: attempt(over), tokens: set, callbackFields: { picked: 'file-1' } });

/** Hooks whose identity answer is a value a misbehaving plugin could return. */
function hooksAnswering(account: unknown) {
  const { hooks } = fixedHooks();
  // Malformed hook output on purpose: the engine must not trust the plugin's declared return type.
  return { ...hooks, readAccount: async () => account as ApiConnectionAccount };
}

describe('granted scopes', () => {
  it('treats a token response without scope as granting exactly the requested scopes (RFC 6749 §5.1)', async () => {
    const deps = unitDeps();
    const result = await finish(deps, {}, tokens('new', { scopes: [] }));
    expect([result.outcome, result.grantedScopes]).toEqual(['connected', ['acme.files']]);
  });

  it('records the scopes the provider reported, including extra ones', async () => {
    const deps = unitDeps();
    await finish(deps, {}, tokens('new', { scopes: ['acme.files', 'acme.profile'] }));
    expect((await deps.records.read({ key: KEY }))?.grantedScopes).toEqual(['acme.files', 'acme.profile']);
  });
});

describe('identity from the plugin hook', () => {
  it('refuses with account-identity-invalid, keeping the hook failure as cause', async () => {
    const cause = new Error('identity endpoint down');
    const deps = unitDeps({ hooks: { ...fixedHooks().hooks, readAccount: async () => { throw cause; } } });
    const error = await refusal(finish(deps));
    expect([error.code, error.cause]).toEqual(['account-identity-invalid', cause]);
  });

  it('refuses an empty account id', async () => {
    const error = await refusal(finish(unitDeps({ hooks: hooksAnswering({ accountId: '', displayName: 'Alice' }) })));
    expect(error.code).toBe('account-identity-invalid');
  });

  it('refuses an account id longer than 256 characters', async () => {
    const error = await refusal(finish(unitDeps({ hooks: hooksAnswering({ accountId: 'a'.repeat(257), displayName: 'Alice' }) })));
    expect(error.code).toBe('account-identity-invalid');
  });

  it('refuses a display name that is not a string', async () => {
    const error = await refusal(finish(unitDeps({ hooks: hooksAnswering({ accountId: 'alice', displayName: 7 }) })));
    expect(error.code).toBe('account-identity-invalid');
  });

  it('refuses a missing identity answer', async () => {
    const error = await refusal(finish(unitDeps({ hooks: hooksAnswering(null) })));
    expect(error.code).toBe('account-identity-invalid');
  });

  it('accepts an empty display name and stores only the two identity fields', async () => {
    const deps = unitDeps({ hooks: hooksAnswering({ accountId: 'alice', displayName: '', email: 'alice@acme.test' }) });
    expect((await finish(deps)).account).toEqual({ accountId: 'alice', displayName: '' });
  });

  it('stores nothing when the identity is refused', async () => {
    const deps = unitDeps({ hooks: hooksAnswering({ accountId: '', displayName: '' }) });
    await refusal(finish(deps));
    expect(await deps.records.read({ key: KEY })).toBeNull();
  });
});

describe('fencing', () => {
  it('refuses an attempt whose generation no longer matches the record', async () => {
    const deps = unitDeps();
    await seedRecord(deps, connectedRecord({ generation: 2 }));
    expect((await refusal(finish(deps, { generation: 1 }))).code).toBe('attempt-superseded');
  });

  it('refuses while a switch is staged on the record', async () => {
    const deps = unitDeps();
    await seedRecord(deps, connectedRecord({ staged: { account: { accountId: 'bob', displayName: 'Bob' }, grantedScopes: ['acme.files'],
      actorId: 'actor-1', generation: 1, expiresAt: '2026-10-20T10:10:00.000Z' } }));
    expect((await refusal(finish(deps, { generation: 1 }))).code).toBe('switch-in-progress');
  });
});

describe('keeping the stored refresh token on a same-account re-consent', () => {
  it('connects without a refresh token on a hosted client when the stored row is unreadable', async () => {
    const deps = unitDeps({ clientKind: 'confidential', client: { clientId: 'acme-web', clientSecret: 'web-secret', authMethod: 'client_secret_post' },
      tokens: { ...memoryTokenStore(), load: async () => { throw new OAuthTokenStoreError({ code: 'owner-mismatch' }); } } });
    await seedRecord(deps, connectedRecord());
    expect((await finish(deps, { generation: 1 }, tokens('new', { refreshToken: null }))).outcome).toBe('connected');
  });

  it('refuses an installed-app re-consent when the stored row is unreadable and the exchange omitted a refresh token', async () => {
    const deps = unitDeps({ tokens: { ...memoryTokenStore(), load: async () => { throw new OAuthTokenStoreError({ code: 'invalid-record' }); } } });
    await seedRecord(deps, connectedRecord());
    expect((await refusal(finish(deps, { generation: 1 }, tokens('new', { refreshToken: null })))).code).toBe('offline-access-required');
  });

  it('surfaces any other token-store failure while reading the stored refresh token and writes nothing', async () => {
    const failure = new Error('vault unavailable');
    const deps = unitDeps({ tokens: { ...memoryTokenStore(), load: async () => { throw failure; } } });
    await seedRecord(deps, connectedRecord());
    const error = await finish(deps, { generation: 1 }, tokens('new', { refreshToken: null })).then(() => null, (caught: unknown) => caught);
    expect([error, (await deps.records.read({ key: KEY }))?.revision]).toEqual([failure, 1]);
  });

  it('does not borrow the refresh token an interrupted first connect left behind for another account', async () => {
    // A first connect fenced the record (no account yet) and installed alice's tokens, then stopped
    // before marking it connected. A hosted exchange for bob without a refresh token must not
    // inherit alice's refresh token.
    const store = memoryTokenStore();
    store.entries.set(KEY, tokens('alice'));
    const deps = unitDeps({ clientKind: 'confidential', tokens: store, hooks: fixedHooks({ accountId: 'bob', displayName: 'Bob' }).hooks,
      client: { clientId: 'acme-web', clientSecret: 'web-secret', authMethod: 'client_secret_post' } });
    await seedRecord(deps, connectedRecord({ status: 'reconnect-required', account: null }));
    await finish(deps, { generation: 1 }, tokens('bob', { refreshToken: null }));
    expect(store.entries.get(KEY)).toEqual(tokens('bob', { refreshToken: null }));
  });

  it('does not borrow the stored refresh token for a different account', async () => {
    const deps = unitDeps({ hooks: fixedHooks({ accountId: 'alice', displayName: 'Alice' }).hooks });
    await seedRecord(deps, connectedRecord({ account: { accountId: 'carol', displayName: 'Carol' } }));
    expect((await refusal(finish(deps, { generation: 1 }, tokens('new', { refreshToken: null })))).code).toBe('account-mismatch');
  });
});

describe('outcomes', () => {
  it('returns the attempt id and the declared callback fields with a connected outcome', async () => {
    const result = await finish(unitDeps(), { attemptId: 'attempt-9' });
    expect([result.connectionRef, result.attemptId, result.callbackFields]).toEqual([KEY, 'attempt-9', { picked: 'file-1' }]);
  });

  it('stages a switch for another account and leaves the live tokens alone', async () => {
    const deps = unitDeps({ hooks: fixedHooks({ accountId: 'bob', displayName: 'Bob' }).hooks });
    await seedRecord(deps, connectedRecord());
    const result = await finish(deps, { intent: 'switch-account', generation: 1 });
    const staged = await deps.tokens.load({ key: stagedTokenKey({ key: KEY }) });
    expect([result.outcome, staged?.accessToken, await deps.tokens.load({ key: KEY })]).toEqual(['staged', 'access-new', null]);
  });

  it('gives a staged switch the attempt lifetime from now', async () => {
    const deps = unitDeps({ hooks: fixedHooks({ accountId: 'bob', displayName: 'Bob' }).hooks });
    await seedRecord(deps, connectedRecord());
    await finish(deps, { intent: 'switch-account', generation: 1, actorId: 'actor-7' });
    expect((await deps.records.read({ key: KEY }))?.staged).toMatchObject({ actorId: 'actor-7', generation: 1,
      expiresAt: '2026-10-20T10:10:00.000Z' });
  });
});
