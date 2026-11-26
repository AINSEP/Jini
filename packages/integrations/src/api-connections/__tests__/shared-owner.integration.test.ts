import assert from 'node:assert/strict';
import { test } from 'vitest';
import { AesGcmSecretSealer } from '@jini-ai/platform/secrets';
import { InMemoryKeyring } from '@jini-ai/platform/secrets/testing';
import { InMemoryVaultRepo, SecretsVaultService, createVaultMetaParsers } from '@jini-ai/platform/secrets/credential-sets';
import { ApiConnectionError } from '../errors.js';
import { parseApiConnectionDescriptor } from '../descriptor.js';
import { realCallbackFieldRules } from './fixtures/real-capabilities.js';
import { createSharedOAuthOwnerStorage } from '../shared-owner.js';
import { createApiConnectionVaultRecordStore, createApiConnectionVaultTokenStore, type ApiConnectionVaultPolicy } from '../vault-stores.js';

const clock = { nowMs: () => 0 };
const policy: ApiConnectionVaultPolicy = {
  scope: ({ workspaceId }) => ({ workspaceId, kind: 'api-connection', ownerKey: 'fixture', principalId: null, binding: null }),
  recordFormat: 'record', attemptFormat: 'attempt', pluginStateFormat: 'state', hashState: ({ state }) => state,
  recordLabel: ({ key }) => key, attemptLabel: ({ attempt }) => attempt.key,
  isOwnerReference: () => false, omittedNotice: ({ count }) => String(count),
};

test('a later client cannot replace the sealed original issuing context', async () => {
  const keyring = new InMemoryKeyring({ hkdfSalt: 'shared-owner' });
  const scope = { workspaceId: 'project', keyring, repo: new InMemoryVaultRepo({}), sealer: new AesGcmSecretSealer({ keyring }) };
  const storage = createSharedOAuthOwnerStorage({ scope, clock, ownerWorkspaceId: 'project',
    createApiConnectionVault: () => new SecretsVaultService({ ...scope,
      metaParsers: createVaultMetaParsers({}, { parsers: { 'api-connection': ({ meta }) => meta as Record<string, string> } }),
      authorize: async () => {}, now: () => '2026-01-01T00:00:00Z', newId: () => 'unused' }),
    createApiConnectionVaultRecordStore: input => createApiConnectionVaultRecordStore({ ...input, policy }),
    createApiConnectionVaultTokenStore: input => createApiConnectionVaultTokenStore({ ...input, policy }),
    apiConnectionVaultScope: policy.scope, contextId: ({ credentialId }) => `context:${credentialId}`,
    contextMeta: { credentialFormat: 'state' }, contextLabel: ({ id }) => id,
    unavailable: () => new ApiConnectionError({ code: 'connection-not-found', message: 'Unavailable' }),
    accountChanged: () => new ApiConnectionError({ code: 'account-changed', message: 'Original client required' }),
  });
  const descriptor = parseApiConnectionDescriptor({ callbackFieldRules: realCallbackFieldRules, value: {
    pluginId: 'fixture', connectionId: 'account', label: 'Account',
    authorizationEndpoint: 'https://issuer.example/authorize', tokenEndpoint: 'https://issuer.example/token',
  } });
  const context = { credentialId: 'saved', descriptor, clientKind: 'public' as const,
    identity: { pluginId: 'fixture', connectionId: 'account', clientId: 'original', tokenEndpoint: descriptor.tokenEndpoint, authorizationEndpoint: descriptor.authorizationEndpoint },
    client: { clientId: 'original', authMethod: 'none' as const },
  };
  await storage.saveContext({ credentialId: 'saved', context });
  const later = { ...context, identity: { ...context.identity, clientId: 'later' }, client: { ...context.client, clientId: 'later' } };
  await assert.rejects(storage.saveContext({ credentialId: 'saved', context: later }), { code: 'account-changed', message: 'Original client required' });
  assert.deepEqual(await storage.readContext({ credentialId: 'saved' }), context);
});
