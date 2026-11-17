---
"@jini-ai/platform": patch
---

`SecretsVaultService.rotate` takes an optional `{ sourceOpener }` that reads the stored row after a key switch; `deps.sealer.open` always means "open with the current keyring", and rotation verifies its fresh envelope with it. A sealer binding must therefore satisfy `open(seal(x)) === x`: run `secretSealerContractViolations` from `@jini-ai/platform/secrets/testing` against each binding. A refused re-seal throws `VaultResealRefusedError` (still `VaultError` / `invalid-record`) naming the failing step, the key generation and the sealer error's name and code, and never an envelope, binding string or plaintext.
