# secrets/credential-sets

Credential-set vault lifecycle (`SecretsVaultService`), metadata parsers, AAD, archive capture and
provider matching. Public entry: `@jini-ai/platform/secrets/credential-sets`.

## Wiring

- `store-vault-guards.ts` (`protectStorage`, `createStoreKeyring`): a host that builds a store-backed
  vault injects a `StorageFailureSource` — its current `KeyringPort` (optional, read at call time) and
  a `storageError` translator that turns any crypto/keyring failure into the feature's safe storage
  error. The host's vault-kinds composition calls `createStoreKeyring` to hand `SecretsVaultService`
  a keyring port, and wraps sealer calls in `protectStorage`.
