import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'vitest';
import { AesGcmSecretSealer } from '@jini-ai/platform/secrets';
import { InMemoryKeyring } from '@jini-ai/platform/secrets/testing';
import { InMemoryVaultRepo, SecretsVaultService, createVaultMetaParsers } from '@jini-ai/platform/secrets/credential-sets';
import { VaultError, type VaultMeta } from '@jini-ai/core/contracts/vault';
import { buildTokenPayload } from '../token-store/record.js';
import { deriveApiConnectionKey } from '../keys.js';
import type { ApiConnectionAttempt, ApiConnectionRecord } from '../types.js';
import { createApiConnectionVaultRecordStore, rebindApiConnectionArchive, type ApiConnectionArchiveEntry, type ApiConnectionVaultPolicy } from '../vault-stores.js';

const policy: ApiConnectionVaultPolicy = {
  scope: ({ workspaceId }) => ({ workspaceId, kind: 'api-connection', ownerKey: 'tovu', principalId: null, binding: null }),
  recordFormat: 'api-connection-record', attemptFormat: 'api-connection-attempt', pluginStateFormat: 'agent-plugin-state',
  hashState: ({ state }) => createHash('sha256').update(state).digest('hex'),
  recordLabel: ({ key }) => `API connection ${key}`,
  attemptLabel: ({ attempt }) => `API connection sign-in ${attempt.key} ${createHash('sha256').update(attempt.state).digest('hex').slice(0, 16)}`,
  isOwnerReference: ({ id }) => ['plugin-state:tovu-key-references:', 'plugin-state:tovu-shared-oauth-binding:', 'plugin-state:tovu-shared-oauth:'].some(prefix => id.startsWith(prefix)),
  omittedNotice: ({ count }) => `${count} unsupported API connection(s) were left out.`,
};

function vault() {
  const keyring = new InMemoryKeyring({ hkdfSalt: 'vault-cutover' });
  return new SecretsVaultService({ repo: new InMemoryVaultRepo({}), keyring, sealer: new AesGcmSecretSealer({ keyring }),
    metaParsers: createVaultMetaParsers({}, { parsers: { 'api-connection': ({ meta }) => meta as Record<string, string> } }),
    authorize: async () => {}, now: () => '2026-01-01T00:00:00Z', newId: () => 'unused' });
}

function pair(): ApiConnectionArchiveEntry[] {
  const owner = { workspaceId: 'source', pluginId: 'plugin', connectionId: 'connection', clientId: 'client' };
  const key = deriveApiConnectionKey(owner);
  const record: ApiConnectionRecord = { ...owner, key, status: 'connected', revision: 8, generation: 4, account: null, grantedScopes: ['read'], staged: { account: { accountId: 'staged-owner', displayName: 'Pending' }, grantedScopes: ['write'], actorId: 'source-authority', generation: 4, expiresAt: 'later' }, revocationFailure: null, updatedAt: 'now' };
  const base = { kind: 'api-connection', ownerKey: 'tovu', binding: null, provider: null, isDefault: false };
  return [
    { ...base, id: `record:${key}`, label: `API connection ${key}`, meta: { credentialFormat: policy.recordFormat }, payload: { record: { ...record } as unknown as VaultMeta } },
    { ...base, id: key, label: key, meta: { credentialFormat: 'oauth-token-set' }, payload: buildTokenPayload({ key, owner, generation: 4, tokens: { accessToken: 'access-secret', refreshToken: 'refresh-secret', tokenType: 'Bearer', scopes: ['read'], expiresAt: null } }) },
  ];
}

test('one of two consumers gets the attempt', async () => {
  const service = vault();
  const store = createApiConnectionVaultRecordStore({ vault: service, workspaceId: 'ws', clock: { nowMs: () => 0 }, policy });
  const attempt: ApiConnectionAttempt = { state: 'bearer', attemptId: 'attempt', key: 'key', ownerKey: 'owner', browserBindingHash: 'hash', workspaceId: 'ws', actorId: 'actor', pluginId: 'plugin', connectionId: 'connection', intent: 'connect', requestedScopes: [], redirectUri: 'https://callback.test', generation: 0, codeVerifier: 'verifier', createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-02T00:00:00Z' };
  await store.putAttempt({ attempt });
  const row = (await service.list(policy.scope({ workspaceId: 'ws' })))[0];
  assert.ok(row);
  assert.equal(row.id, `attempt:${policy.hashState({ state: attempt.state })}`);
  assert.equal(row.label, policy.attemptLabel({ attempt }));
  assert.deepEqual(row.meta, { credentialFormat: 'api-connection-attempt', expiresAtMs: Date.parse(attempt.expiresAt) });
  const results = await Promise.all([store.takeAttempt({ state: 'bearer' }), store.takeAttempt({ state: 'bearer' })]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.deepEqual(results.find(Boolean), attempt);
});

test('record sealed under another key is rejected', async () => {
  const service = vault();
  const scope = policy.scope({ workspaceId: 'ws' });
  await service.put({ ...scope, id: 'record:requested', expectedRevision: null, provider: null, label: 'copied', meta: { credentialFormat: policy.recordFormat }, payload: { record: { key: 'other' } } });
  const store = createApiConnectionVaultRecordStore({ vault: service, workspaceId: 'ws', clock: { nowMs: () => 0 }, policy });
  await assert.rejects(store.read({ key: 'requested' }), error => error instanceof VaultError && error.code === 'invalid-record');
});

test('rebind omits shared, staged and incomplete rows without identity in diagnostics', () => {
  const [record, token] = pair();
  assert.ok(record && token);
  const rows: ApiConnectionArchiveEntry[] = [record,
    { ...token, id: `${token.id}#staged` }, { ...token, id: 'plugin-state:tovu-shared-oauth:private-id' },
    { ...token, id: 'attempt:private-state', meta: { credentialFormat: policy.attemptFormat } }];
  const result = rebindApiConnectionArchive({ entries: rows, workspaceId: 'receiver', policy });
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.notices, ['1 unsupported API connection(s) were left out.']);
  assert.equal(JSON.stringify(result.notices).includes('private'), false);
});

test('receiver pair retains generation and changes owner key', () => {
  const rows = pair();
  const result = rebindApiConnectionArchive({ entries: rows, workspaceId: 'receiver', policy });
  const expectedKey = deriveApiConnectionKey({ workspaceId: 'receiver', pluginId: 'plugin', connectionId: 'connection' });
  const [record, token] = result.entries;
  assert.ok(record && token);
  assert.equal(record.id, `record:${expectedKey}`);
  assert.equal(token.id, expectedKey);
  assert.deepEqual(record.payload?.record, { workspaceId: 'receiver', key: expectedKey, pluginId: 'plugin', connectionId: 'connection', status: 'connected', revision: 1, generation: 4, account: null, grantedScopes: ['read'], staged: null, revocationFailure: null, updatedAt: 'now' });
  assert.deepEqual(token.payload?.owner, { workspaceId: 'receiver', pluginId: 'plugin', connectionId: 'connection', clientId: 'client' });
  assert.deepEqual(result.notices, []);
});

test('archive generation and derived-key mismatches omit the pair', () => {
  for (const mismatch of ['generation', 'derived-key', 'record-id']) {
    const rows = pair();
    const [record, token] = rows;
    assert.ok(record?.payload && token?.payload);
    if (mismatch === 'generation') token.payload.generation = 99;
    if (mismatch === 'derived-key') { const value = record.payload.record; assert.ok(value && typeof value === 'object' && !Array.isArray(value)); value.key = 'tampered'; }
    if (mismatch === 'record-id') record.id = 'record:tampered';
    const result = rebindApiConnectionArchive({ entries: rows, workspaceId: 'receiver', policy });
    assert.deepEqual(result.entries, []);
    assert.match(result.notices.join(''), /^\d+ unsupported API connection\(s\) were left out\.$/);
  }
});

test('expiry sweep uses the observed revision and ignores only conflicts', async () => {
  const service = vault();
  const row = await service.put({ ...policy.scope({ workspaceId: 'ws' }), id: 'expired', expectedRevision: null, provider: null, label: 'expired', meta: { credentialFormat: policy.attemptFormat, expiresAtMs: 0 } });
  let deleted = false;
  const store = createApiConnectionVaultRecordStore({ vault: { get: service.get.bind(service), put: service.put.bind(service), list: service.list.bind(service), delete: async input => { assert.equal(input.expectedRevision, row.revision); deleted = true; throw new VaultError({ code: 'conflict' }); } }, workspaceId: 'ws', clock: { nowMs: () => 1 }, policy });
  const attempt = { state: 'new', expiresAt: '2026-01-02' } as ApiConnectionAttempt;
  await store.putAttempt({ attempt });
  assert.equal(deleted, true);
  const failure = new Error('storage failure');
  const failing = createApiConnectionVaultRecordStore({ vault: { get: service.get.bind(service), put: service.put.bind(service), list: service.list.bind(service), delete: async () => { throw failure; } }, workspaceId: 'ws', clock: { nowMs: () => 1 }, policy });
  await assert.rejects(failing.putAttempt({ attempt }), error => error === failure);
});

test('record create and replacement retain revision CAS', async () => {
  const service = vault();
  const store = createApiConnectionVaultRecordStore({ vault: service, workspaceId: 'ws', clock: { nowMs: () => 0 }, policy });
  const record = { key: 'key', revision: 1 } as ApiConnectionRecord;
  assert.equal(await store.compareAndSet({ key: 'key', expectedRevision: 0, record }), true);
  assert.equal(await store.compareAndSet({ key: 'key', expectedRevision: 0, record }), false);
  const read = await store.read({ key: 'key' });
  assert.ok(read);
  assert.equal(await store.compareAndSet({ key: 'key', expectedRevision: read.revision, record: { ...record, revision: 2 } }), true);
  assert.equal(await store.compareAndSet({ key: 'key', expectedRevision: read.revision, record: { ...record, revision: 3 } }), false);
});
