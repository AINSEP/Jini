---
"@jini-ai/core": minor
"@jini-ai/integrations": minor
---

`KeyringPort` has one owner, `@jini-ai/core/contracts/vault`: `@jini-ai/integrations/secrets`' `KeyringPort` and core's `CredentialSetKeyringPort` are now type aliases of it, so `activeKey` always takes the `{}` options argument and a host's one keyring plugs into every seam unadapted. Callers of a zero-argument `activeKey()` pass `{}`; implementations with a zero-argument `activeKey` still satisfy the port. No crypto behaviour changes.
