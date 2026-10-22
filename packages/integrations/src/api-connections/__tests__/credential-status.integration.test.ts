/** @file Real vault codec + connection service regressions: incompatible credentials require
 * reconnecting, stay sealed and intact, and never escape as internal store errors. No HTTP. */
import { describe, expect, it } from 'vitest';
import { AesGcmSecretSealer } from '@jini-ai/platform/secrets';
import { InMemoryKeyring } from '@jini-ai/platform/secrets/testing';
import { InMemoryVaultRepo, SecretsVaultService, createVaultMetaParsers } from '@jini-ai/platform/secrets/credential-sets';
import { ApiConnectionError, createApiConnectionGenerationReader, createApiConnectionService,
  createVaultOAuthTokenStore, parseOAuthTokenVaultMeta } from '../index.js';
import { buildRecordMeta, buildTokenPayload } from '../token-store/record.js';
import { KEY, connectedRecord, seedRecord, tokens, unitDeps } from './fixtures/unit-deps.js';

const scope = { workspaceId: 'ws-1', kind: 'api-connection', ownerKey: 'test-host', principalId: null, binding: null } as const;
const owner = { workspaceId: 'ws-1', pluginId: 'acme-office', connectionId: 'account', clientId: 'acme-desktop' };

function fixture() {
  const deps = unitDeps();
  const repo = new InMemoryVaultRepo({});
  const keyring = new InMemoryKeyring({ hkdfSalt: 'credential-status-tests' });
  const vault = new SecretsVaultService({ repo, keyring, sealer: new AesGcmSecretSealer({ keyring }),
    metaParsers: createVaultMetaParsers({}, { parsers: { 'api-connection': parseOAuthTokenVaultMeta } }),
    authorize: async () => {}, now: () => '2026-10-20T10:00:00.000Z', newId: () => 'unused-id' });
  const store = createVaultOAuthTokenStore({ vault, vaultScope: scope, owner, clock: deps.clock,
    readGeneration: createApiConnectionGenerationReader({ records: deps.records }) });
  return { deps, repo, vault, service: createApiConnectionService({ ...deps, tokens: store }) };
}

describe('incompatible sealed credentials', () => {
  it.each(['payload version', 'missing generation', 'metadata status', 'changed client'] as const)(
    '%s becomes reconnect-required without deleting or rewriting the credential', async corruption => {
      const f = fixture();
      await seedRecord(f.deps, connectedRecord());
      const payload = buildTokenPayload({ key: KEY, owner, generation: 1, tokens: tokens('legacy') });
      if (corruption === 'payload version') payload.version = 99;
      if (corruption === 'missing generation') delete payload.generation;
      if (corruption === 'changed client') payload.owner = { ...owner, clientId: 'previous-client' };
      await f.vault.put({ ...scope, id: KEY, expectedRevision: null, provider: null, label: KEY, payload,
        meta: buildRecordMeta({ meta: { status: 'active', leaseHolder: null, leaseExpiresAtMs: null } }) });
      if (corruption === 'metadata status') {
        // A historical/corrupted row bypassed today's complete-shape parser on write.
        await f.repo.patchMeta({ workspaceId: scope.workspaceId, id: KEY, expectedRevision: 1,
          patch: { status: 'legacy' }, updatedAt: '2026-10-20T10:00:01.000Z' });
      }
      const before = await f.repo.find({ workspaceId: scope.workspaceId, id: KEY });
      const recordBefore = await f.deps.records.read({ key: KEY });
      expect((await f.service.getStatus({ connectionRef: KEY, workspaceId: scope.workspaceId })).status).toBe('reconnect-required');
      expect(await f.deps.records.read({ key: KEY })).toEqual(recordBefore);
      const error = await f.service.getAccessToken({ connectionRef: KEY, workspaceId: scope.workspaceId })
        .then(() => null, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(ApiConnectionError);
      expect(error).toMatchObject({ code: 'reconnect-required',
        message: 'This connection needs to be reconnected. Reconnect the account in the connection settings.' });
      expect((await f.deps.records.read({ key: KEY }))?.status).toBe('reconnect-required');
      expect(await f.repo.find({ workspaceId: scope.workspaceId, id: KEY })).toEqual(before);
    },
  );
});
