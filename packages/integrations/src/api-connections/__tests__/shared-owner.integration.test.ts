import assert from 'node:assert/strict';
import { test } from 'vitest';
import { AesGcmSecretSealer } from '@jini-ai/platform/secrets';
import { InMemoryKeyring } from '@jini-ai/platform/secrets/testing';
import { InMemoryVaultRepo, SecretsVaultService, createVaultMetaParsers } from '@jini-ai/platform/secrets/credential-sets';
import { ApiConnectionError } from '../errors.js';
import { parseApiConnectionDescriptor } from '../descriptor.js';
import { realCallbackFieldRules } from './fixtures/real-capabilities.js';
import { createSharedOAuthLabels, createSharedOAuthOwnerStorage, type SharedOAuthIssuingContext } from '../shared-owner.js';
import type { ApiConnectionRecord } from '../types.js';
import { createApiConnectionVaultRecordStore, createApiConnectionVaultTokenStore, type ApiConnectionVaultPolicy } from '../vault-stores.js';

const clock = { nowMs: () => 0 };
const policy: ApiConnectionVaultPolicy = {
  scope: ({ workspaceId }) => ({ workspaceId, kind: 'api-connection', ownerKey: 'fixture', principalId: null, binding: null }),
  recordFormat: 'record', attemptFormat: 'attempt', pluginStateFormat: 'state', hashState: ({ state }) => state,
  recordLabel: ({ key }) => key, attemptLabel: ({ attempt }) => attempt.key,
  isOwnerReference: () => false, omittedNotice: ({ count }) => String(count),
};

type StorageRequired = Parameters<typeof createSharedOAuthOwnerStorage>[0];
type TokenStoreInput = Parameters<StorageRequired['createApiConnectionVaultTokenStore']>[0];

/** Real sealed vault + real vault record/token stores; only the policy and error factories are fixture values. */
function ownerFixture(optional: { scopeWorkspaceId?: string } = {}) {
  const keyring = new InMemoryKeyring({ hkdfSalt: 'shared-owner' });
  const scope = { workspaceId: optional.scopeWorkspaceId ?? 'project', keyring, repo: new InMemoryVaultRepo({}), sealer: new AesGcmSecretSealer({ keyring }) };
  const tokenInputs: TokenStoreInput[] = [];
  const vaultsCreated: unknown[] = [];
  const required: StorageRequired = { scope, clock, ownerWorkspaceId: 'project',
    createApiConnectionVault: input => {
      vaultsCreated.push(input);
      return new SecretsVaultService({ ...scope,
        metaParsers: createVaultMetaParsers({}, { parsers: { 'api-connection': ({ meta }) => meta as Record<string, string> } }),
        authorize: async () => {}, now: () => '2026-01-01T00:00:00Z', newId: () => 'unused' });
    },
    createApiConnectionVaultRecordStore: input => createApiConnectionVaultRecordStore({ ...input, policy }),
    createApiConnectionVaultTokenStore: input => { tokenInputs.push(input); return createApiConnectionVaultTokenStore({ ...input, policy }); },
    apiConnectionVaultScope: policy.scope, contextId: ({ credentialId }) => `context:${credentialId}`,
    contextMeta: { credentialFormat: 'state' }, contextLabel: ({ id }) => id,
    unavailable: () => new ApiConnectionError({ code: 'connection-not-found', message: 'Unavailable' }),
    accountChanged: () => new ApiConnectionError({ code: 'account-changed', message: 'Original client required' }),
  };
  return { required, tokenInputs, vaultsCreated };
}

function issuingContext(): SharedOAuthIssuingContext {
  const descriptor = parseApiConnectionDescriptor({ callbackFieldRules: realCallbackFieldRules, value: {
    pluginId: 'fixture', connectionId: 'account', label: 'Account',
    authorizationEndpoint: 'https://issuer.example/authorize', tokenEndpoint: 'https://issuer.example/token',
  } });
  return { credentialId: 'saved', descriptor, clientKind: 'public' as const,
    identity: { pluginId: 'fixture', connectionId: 'account', clientId: 'original', tokenEndpoint: descriptor.tokenEndpoint, authorizationEndpoint: descriptor.authorizationEndpoint },
    client: { clientId: 'original', authMethod: 'none' as const },
  };
}

function ownerRecord(overrides: Partial<ApiConnectionRecord> = {}): ApiConnectionRecord {
  return { key: 'saved', workspaceId: 'project', pluginId: 'fixture', connectionId: 'account', status: 'connected', revision: 1, generation: 3,
    account: { accountId: 'acct-1', displayName: 'Ada' }, grantedScopes: ['read'], staged: null, revocationFailure: null, updatedAt: 'now', ...overrides };
}

const unavailable = { code: 'connection-not-found', message: 'Unavailable' };

test('a later client cannot replace the sealed original issuing context', async () => {
  const storage = createSharedOAuthOwnerStorage(ownerFixture().required);
  const context = issuingContext();
  await storage.saveContext({ credentialId: 'saved', context });
  const later = { ...context, identity: { ...context.identity, clientId: 'later' }, client: { ...context.client, clientId: 'later' } };
  await assert.rejects(storage.saveContext({ credentialId: 'saved', context: later }), { code: 'account-changed', message: 'Original client required' });
  assert.deepEqual(await storage.readContext({ credentialId: 'saved' }), context);
});

test('owner storage refuses a scope bound to another workspace before opening any vault', () => {
  const fixture = ownerFixture({ scopeWorkspaceId: 'site-b' });
  assert.throws(() => createSharedOAuthOwnerStorage(fixture.required), unavailable);
  assert.deepEqual(fixture.vaultsCreated, []);
});

test('saving the identical context again is a no-op and writes one sealed row', async () => {
  const storage = createSharedOAuthOwnerStorage(ownerFixture().required);
  const context = issuingContext();
  await storage.saveContext({ credentialId: 'saved', context });
  await storage.saveContext({ credentialId: 'saved', context: issuingContext() });
  const rows = await storage.vault.list(policy.scope({ workspaceId: 'project' }));
  assert.deepEqual(rows.map(row => [row.id, row.label, row.revision]), [['context:saved', 'context:saved', 1]]);
});

test('saveContext refuses a context for another credential or a client that is not the declared identity', async () => {
  const storage = createSharedOAuthOwnerStorage(ownerFixture().required);
  const context = issuingContext();
  await assert.rejects(storage.saveContext({ credentialId: 'other', context }), unavailable);
  await assert.rejects(storage.saveContext({ credentialId: 'saved', context: { ...context, client: { ...context.client, clientId: 'swapped' } } }), unavailable);
  assert.equal(await storage.readContext({ credentialId: 'saved' }), null);
});

const tampered: ReadonlyArray<readonly [string, (context: SharedOAuthIssuingContext) => unknown]> = [
  ['no sealed value', () => undefined],
  ['copied under another credential', context => ({ ...context, credentialId: 'other' })],
  ['missing identity', context => ({ ...context, identity: null })],
  ['client differs from identity', context => ({ ...context, client: { ...context.client, clientId: 'swapped' } })],
  ['token endpoint differs', context => ({ ...context, identity: { ...context.identity, tokenEndpoint: 'https://evil.example/token' } })],
  ['authorization endpoint differs', context => ({ ...context, identity: { ...context.identity, authorizationEndpoint: 'https://evil.example/authorize' } })],
  ['plugin differs', context => ({ ...context, identity: { ...context.identity, pluginId: 'other-plugin' } })],
  ['connection differs', context => ({ ...context, identity: { ...context.identity, connectionId: 'other-connection' } })],
];

test('readContext refuses a sealed context that was copied or whose client no longer matches its identity', async () => {
  for (const [name, mutate] of tampered) {
    const storage = createSharedOAuthOwnerStorage(ownerFixture().required);
    const value = mutate(issuingContext());
    await storage.vault.put({ ...policy.scope({ workspaceId: 'project' }), id: 'context:saved', expectedRevision: null, provider: null, label: 'context:saved',
      meta: { credentialFormat: 'state' }, payload: value === undefined ? { other: 'x' } : { value: JSON.parse(JSON.stringify(value)) } });
    await assert.rejects(storage.readContext({ credentialId: 'saved' }), unavailable, name);
  }
});

test('an identity without an authorization endpoint is accepted for any descriptor endpoint', async () => {
  const storage = createSharedOAuthOwnerStorage(ownerFixture().required);
  const base = issuingContext();
  const context = { ...base, identity: { pluginId: 'fixture', connectionId: 'account', clientId: 'original', tokenEndpoint: base.descriptor.tokenEndpoint } };
  await storage.saveContext({ credentialId: 'saved', context });
  assert.deepEqual(await storage.readContext({ credentialId: 'saved' }), context);
});

test('tokensFor binds the token store to the owner workspace and the sealed client', () => {
  const fixture = ownerFixture();
  const storage = createSharedOAuthOwnerStorage(fixture.required);
  storage.tokensFor({ context: issuingContext() });
  assert.equal(fixture.tokenInputs.length, 1);
  const [input] = fixture.tokenInputs;
  assert.ok(input);
  assert.equal(input.vault, storage.vault);
  assert.equal(input.records, storage.records);
  assert.equal(input.clock, clock);
  assert.deepEqual(input.owner, { workspaceId: 'project', pluginId: 'fixture', connectionId: 'account', clientId: 'original' });
});

test('readConnection projects the owner record only when both the context and the record exist', async () => {
  const storage = createSharedOAuthOwnerStorage(ownerFixture().required);
  assert.equal(await storage.readConnection({ credentialId: 'saved' }), null);
  const context = issuingContext();
  await storage.saveContext({ credentialId: 'saved', context });
  assert.equal(await storage.readConnection({ credentialId: 'saved' }), null);
  assert.equal(await storage.records.compareAndSet({ key: 'saved', expectedRevision: 0, record: ownerRecord() }), true);
  assert.deepEqual(await storage.readConnection({ credentialId: 'saved' }), { credentialId: 'saved', identity: context.identity, generation: 3,
    status: 'connected', account: { accountId: 'acct-1', displayName: 'Ada' }, grantedScopes: ['read'] });
});

test('readConnection refuses a record bound to another workspace, plugin or connection', async () => {
  for (const overrides of [{ workspaceId: 'site-b' }, { pluginId: 'other-plugin' }, { connectionId: 'other-connection' }]) {
    const storage = createSharedOAuthOwnerStorage(ownerFixture().required);
    await storage.saveContext({ credentialId: 'saved', context: issuingContext() });
    await storage.records.compareAndSet({ key: 'saved', expectedRevision: 0, record: ownerRecord(overrides) });
    await assert.rejects(storage.readConnection({ credentialId: 'saved' }), unavailable, JSON.stringify(overrides));
  }
});

test('labels show the unavailable text until the account exists, then the projected account label', async () => {
  const fixture = ownerFixture();
  const seen: unknown[] = [];
  const label = createSharedOAuthLabels({ ...fixture.required, unavailableLabel: 'Unavailable account',
    accountLabel: input => { seen.push(input); return `${input.context.identity.clientId}:${input.connection.account?.displayName}`; } });
  assert.equal(await label({ keyId: 'saved' }), 'Unavailable account');
  const storage = createSharedOAuthOwnerStorage(fixture.required);
  const context = issuingContext();
  await storage.saveContext({ credentialId: 'saved', context });
  assert.equal(await label({ keyId: 'saved' }), 'Unavailable account');
  await storage.records.compareAndSet({ key: 'saved', expectedRevision: 0, record: ownerRecord() });
  assert.equal(await label({ keyId: 'saved' }), 'original:Ada');
  assert.deepEqual(seen, [{ context, connection: { credentialId: 'saved', identity: context.identity, generation: 3, status: 'connected',
    account: { accountId: 'acct-1', displayName: 'Ada' }, grantedScopes: ['read'] } }]);
});
