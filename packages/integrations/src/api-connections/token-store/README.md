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
// store: OAuthTokenStore (all optional lease methods implemented)
//        & { install({ key, tokens, generation }), loadForRevocation({ key }), delete({ key }) }
const refresher = createTokenRefresher({ clock, sleep, port: { ...store, refresh } });
```

Also exported from `@jini-ai/integrations/api-connections`: `parseOAuthTokenVaultMeta` (the vault
metadata parser) and the `OAuthTokenStoreErrorCode` type. The store throws `OAuthTokenStoreError`
(typed `code` + fixed `message` + `nextAction`); that class and the record format tag stay internal
to this folder (`./index.ts`), so hosts read `code`, never `instanceof`.

## How it stores things

- One vault row per connection key (`id = key`, `label = key`) under `vaultScope`. The vault keeps
  labels unique per scope, and one scope holds main and staged rows of many connections.
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
| A disabled credential can still be revoked | `loadForRevocation` returns the sealed tokens of any generation (owner-checked) and is not recorded as a load. The service passes them only to the plugin's revoke hook. |
| Rotation is durable before the lease is released | `persist` returns only after the vault write; the refresher releases afterwards. |
| `invalid_grant` → reconnect required | `markNeedsReauth` clears the sealed tokens and sets `status: "reconnect-required"`; the reason string is not stored. |
| A sign-in install is fenced without a lease | `install({ key, tokens, generation })` refuses (`stale-generation`) when the live generation is not `generation` or the stored payload is from a newer generation; a CAS conflict re-reads and retries up to 3 times (`write-conflict`). Recent loads do not block it, because its tokens are freshly issued rather than derived from a load. |
| Disconnect clears the secret | `delete` removes the row (retries the CAS up to 3 times, then `write-conflict`). It needs only the row's revision, so it also removes a row this owner can no longer open. |
| A changed client or a corrupt row never locks a connection out | `install` may replace a row whose payload is malformed or sealed for another `clientId` of the same key and connection (the host changed its OAuth client); a row sealed for another key, workspace, plugin or connection is still `owner-mismatch`. `load` and `loadForRevocation` keep refusing such rows; the service then deletes the row on disconnect and reports `pending` (see the api-connections README). |

## Host responsibilities

1. Pick the vault kind for these rows and register the parser for it:
   `createVaultMetaParsers({}, { parsers: { [kind]: parseOAuthTokenVaultMeta } })`. The platform
   ships the dedicated `api-connection` vault kind for these rows (not copyable between workspaces);
   the store never chooses a kind itself.
   If a host shares that kind with connection records, attempts or plugin settings, its owning
   parser must dispatch on `credentialFormat` and use this parser only for OAuth token rows.
   Register that same dispatcher in boot validation, recovery and feature reads. Host recovery
   annotations must be validated and separated before the strict format parser, then preserved;
   an annotated settings row is still settings, and must never fall through to the OAuth parser.
2. Own `readGeneration`: increment it **before** disconnect, account switch or reconnect.
3. Write tokens from a connect or switch flow with `install`, passing the generation the flow
   moved the connection to (the api-connections service does this). `persist` stays the
   refresher's lease-held write.

## Extension points

A second provider plugin needs nothing new here: it gets its own `owner` (plugin, connection and
client ids) and connection keys; all provider-specific behaviour (endpoints, scopes, revocation)
stays in the plugin's `refresh` implementation.
