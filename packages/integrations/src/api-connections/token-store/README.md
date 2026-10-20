# Vault-backed OAuth token store

`createVaultOAuthTokenStore` adapts the platform secrets vault
(`@jini-ai/platform/secrets/credential-sets`) to the OAuth engine's `OAuthTokenStore` port
(`@jini-ai/oauth`). It lets `createTokenRefresher` keep API-connection tokens in the same sealed,
AAD-bound, revision-checked store as every other credential, with no new crypto.

## Public API

```ts
const store = createVaultOAuthTokenStore({
  vault,            // SecretsVaultService (or anything with get/put/patchMeta/delete)
  vaultScope,       // VaultContext the rows live under; workspaceId must equal owner.workspaceId
  owner,            // { workspaceId, pluginId, connectionId, clientId } every read must match
  readGeneration,   // ({ key }) => Promise<number>; the host bumps it on disconnect/switch/reconnect
  clock,            // Clock from @jini-ai/core/primitives
});
// store: OAuthTokenStore (all optional lease methods implemented) & { delete({ key }) }
const refresher = createTokenRefresher({ clock, sleep, port: { ...store, refresh } });
```

Also exported: `parseOAuthTokenVaultMeta` (the vault metadata parser), `OAuthTokenStoreError`
(typed `code` + fixed `message` + `nextAction`), `OAUTH_TOKEN_RECORD_FORMAT`.

## How it stores things

- One vault row per connection key (`id = key`) under `vaultScope`.
- Sealed payload: `{ format, version, key, owner, generation, tokens | null }`. The key and the
  owner are sealed with the tokens, so a row that belongs to another connection or client is
  refused on read (`owner-mismatch`), on top of the vault's own AAD binding.
- Plaintext metadata: `{ credentialFormat: "oauth-token-set", status, leaseHolder, leaseExpiresAtMs }`.
  No token, reason text or provider detail is ever written there.

## Guarantees

| Guarantee | How |
|---|---|
| One refresher at a time, across processes | Lease in metadata, claimed with the vault's revision CAS; expires after 30 s so a crashed holder frees it. |
| A late refresh cannot resurrect tokens | `persist`/`markNeedsReauth` require this instance's lease, re-read the live generation (must equal the one recorded at lease time) and the stored holder (must still be this lease) right before the CAS write. |
| Old-account tokens are never served | `load` returns `null` for a payload sealed under an older generation. A lease is refused when a recent `load` saw a different generation than the live one. |
| Rotation is durable before the lease is released | `persist` returns only after the vault write; the refresher releases afterwards. |
| `invalid_grant` → reconnect required | `markNeedsReauth` clears the sealed tokens and sets `status: "reconnect-required"`; the reason string is not stored. |
| Disconnect clears the secret | `delete` removes the row (retries the CAS up to 3 times, then `write-conflict`). |

## Host responsibilities

1. Pick the vault kind for these rows and register the parser for it:
   `createVaultMetaParsers({}, { parsers: { [kind]: parseOAuthTokenVaultMeta } })`. The existing
   vault kinds each belong to another feature, so a dedicated kind (and its schema check) is the
   expected follow-up; the store never chooses a kind itself.
2. Own `readGeneration`: increment it **before** disconnect, account switch or reconnect.
3. Write tokens from a connect flow the same way the refresher does: `tryAcquireRefreshLease`,
   `persist`, `releaseRefreshLease`.

## Extension points

A second provider plugin needs nothing new here: it gets its own `owner` (plugin, connection and
client ids) and connection keys; all provider-specific behaviour (endpoints, scopes, revocation)
stays in the plugin's `refresh` implementation.
