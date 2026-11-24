# `@jini-ai/server/owner-store`

Read-only access to a legacy owner store (`owner.db` + `owner.key`). Nothing here writes the store, runs its
migrations or creates its key.

## Wiring

Why the host passes the implementations in: `ADS-memory/reports/jini-port/extraction-plan.md` (owner rule K5:
no package imports another package's implementation).

**Ports it needs injected** (`LegacyOwnerStorePorts<Kernel, Vault, Entry, Options>`, generic so this folder
imports only `@jini-ai/core` types):

- `openKernel`: opens the file; always called with `{ readOnly: true }` (`openSqliteFileKernel`, `@jini-ai/db/kernel/sqlite`).
- `countOwnerStoreRows`, `listOwnerEntryRows`, `listOwnerDestinations`: the SQL reads (`@jini-ai/db/owner-store`).
- `createVaultRepo`: the vault repo over that same connection (`SqlSecretsVaultRepo`, `@jini-ai/db/secrets-vault`).
- `ownerWorkspaceId`, `openLegacyOwnerVault`, `readLegacyOwnerEntry`: the decoder (`@jini-ai/platform/secrets/legacy-owner`).

**Provides**: `countLegacyOwnerStore` (no key needed) and `readLegacyOwnerStore` (decrypts every entry, lists
grants and pending revocations). Both open one read-only connection and always close it.

```ts
const ports = {
  openKernel: (file, options) => openSqliteFileKernel<LegacyOwnerDatabase>(file, options),
  countOwnerStoreRows, listOwnerEntryRows, listOwnerDestinations,
  // Kysely's DB generic is invariant; the vault sees only its table on this same connection.
  createVaultRepo: ({ kernel }) => new SqlSecretsVaultRepo({ kernel: kernel as unknown as KyselyKernel<SecretsVaultDatabase> }),
  ownerWorkspaceId: OWNER_WORKSPACE_ID, openLegacyOwnerVault, readLegacyOwnerEntry,
};
const counts = await countLegacyOwnerStore({ filePath, open, ports });
const snapshot = await readLegacyOwnerStore({ filePath, keyFilePath, open, ports }, { metaParsers });
```

**Must never import**: any implementation from `@jini-ai/db` or `@jini-ai/platform` (type-only `@jini-ai/core`
contracts are the only cross-package imports allowed here). The test fixture in `__tests__/fixture.ts` plays
the host and wires the real implementations.
