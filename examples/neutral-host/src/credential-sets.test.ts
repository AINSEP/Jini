import { expect, it } from 'vitest';
import { AesGcmSecretSealer } from '@jini-ai/platform/secrets';
import { createVaultMetaParsers, InMemoryVaultRepo, SecretsVaultService, VaultError } from '@jini-ai/platform/secrets/credential-sets';
import { InMemoryKeyring } from '@jini-ai/platform/secrets/testing';
import {
  createCredentialSet, CredentialSetVaultRepo, CustomCredentialDuplicateLabelError, deleteCredentialSet, describeCredentialSetByLabel,
  listCredentialSets, resolveCredentialSetByLabel,
  type CredentialSetStoreHost, type CredentialSetVaultPolicy, type CredentialSetWriteDeps,
} from '@jini-ai/integrations/credentialed-http/sets';

/**
 * @file A neutral host wires the public `@jini-ai/integrations/credentialed-http/sets` entry with the
 * platform vault parts: its own owner key, category list, token policy and wording. Nothing here is
 * a product value of the host the store came from.
 */

type Shelf = 'books' | 'tools';
const OWNER = 'library-host';

function wire() {
  const policy: CredentialSetVaultPolicy = {
    ownerKey: OWNER,
    parseMeta: ({ kind, meta, provider }) => createVaultMetaParsers({})[kind]({ meta, provider }),
    compareLabels: (a, b) => a.label.localeCompare(b.label),
    vaultErrors: { create: ({ code }) => new VaultError({ code }), codeOf: error => (error instanceof VaultError ? error.code : undefined) },
    labelConflict: () => new Error('library: label taken'),
  };
  const host: CredentialSetStoreHost<Shelf> = {
    vault: policy,
    openVault: ({ deps, kind }) => new SecretsVaultService({
      repo: deps.repo.vault!, keyring: deps.keyring!, sealer: deps.sealer, metaParsers: createVaultMetaParsers({}),
      authorize: async ({ context }) => { if (context.ownerKey !== OWNER || context.kind !== kind) throw new VaultError({ code: 'context' }); },
      now: () => '2026-11-09T00:00:00.000Z', newId: () => { throw new Error('the store mints ids'); },
    }),
    scopes: (deps, workspaceId) => [{ deps, workspaceId, scope: 'site' as const }],
    createTarget: (deps, input) => ({ deps, workspaceId: input.workspaceId, scope: 'site' }),
    isUniqueViolation: error => error instanceof Error && error.message === 'library: label taken',
    isCreateConflict: (error): error is Error => error instanceof TypeError && error.message === 'library: create conflict',
    token: {
      normalize: ({ value }) => { if (typeof value !== 'string' || !value.trim()) throw new RangeError('library: a token is required'); return value.trim(); },
      assertFreeField: () => undefined,
      isInputError: (error): error is Error => error instanceof RangeError,
    },
    normalizeWorksFor: ({ value }) => (Array.isArray(value) ? value.map(String) : []),
    categories: ['books', 'tools'],
    messages: {
      storage: 'library storage unavailable', worksForInvalid: 'library: worksFor must list ids', sharedReplacementReadOnly: 'library: read-only',
      sharedDeleteReadOnly: 'library: read-only', duplicateLabel: ({ label }) => `library already has ${label}`,
      projectDuplicateLabel: ({ label }) => `library project already has ${label}`, notFound: ({ id }) => `library has no ${id}`,
    },
  };
  const vault = new InMemoryVaultRepo({});
  const platformKeyring = new InMemoryKeyring({ hkdfSalt: 'library-host' }, { keyId: 'lib-1' });
  const keyring = { activeKey: () => platformKeyring.activeKey({}), derive: platformKeyring.derive.bind(platformKeyring),
    deriveSigningSecret: platformKeyring.deriveSigningSecret.bind(platformKeyring) };
  let n = 0;
  const deps: CredentialSetWriteDeps<Shelf> = {
    repo: new CredentialSetVaultRepo<Shelf>({ vault, policy }), sealer: new AesGcmSecretSealer({ keyring: platformKeyring }), keyring,
    clock: { nowMs: () => 0 }, idGen: { newId: () => `lib-${++n}` },
  };
  return { host, deps, vault };
}

it('credential sets: a neutral host stores, lists, resolves and deletes through the public entry with its own owner and wording', async () => {
  const { host, deps, vault } = wire();
  const input = { workspaceId: 'branch-1', label: 'Catalog API', category: 'books', baseUrl: 'https://catalog.library.test', connection: { token: 'lib-token-0123456789' } };
  const made = await createCredentialSet({ host, deps, input });
  const [row] = await vault.list({ workspaceId: 'branch-1', kind: 'vendor', ownerKey: OWNER, principalId: null });
  expect({ ownerKey: row!.ownerKey, principalId: row!.principalId, binding: row!.binding, category: row!.meta.category }).toEqual({ ownerKey: OWNER, principalId: null, binding: null, category: 'books' });
  expect(JSON.stringify(await listCredentialSets({ host, deps, input: { workspaceId: 'branch-1' } }))).not.toContain('lib-token');
  expect((await describeCredentialSetByLabel({ host, deps, input: { workspaceId: 'branch-1', label: 'Catalog API' } }))?.id).toBe(made.id);
  expect((await resolveCredentialSetByLabel({ host, deps, input: { workspaceId: 'branch-1', label: 'Catalog API' } }))?.connection.token).toBe('lib-token-0123456789');
  const duplicate = await createCredentialSet({ host, deps, input }).catch((error: unknown) => error);
  expect(duplicate).toBeInstanceOf(CustomCredentialDuplicateLabelError);
  expect((duplicate as Error).message).toBe('library already has Catalog API');
  await expect(createCredentialSet({ host, deps, input: { ...input, label: 'Other', category: 'ops' } })).rejects.toThrow('category must be one of: books, tools');
  await deleteCredentialSet({ host, deps, input: { workspaceId: 'branch-1', id: made.id } });
  expect(await listCredentialSets({ host, deps, input: { workspaceId: 'branch-1' } })).toEqual([]);
});
