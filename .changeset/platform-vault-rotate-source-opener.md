---
"@jini-ai/platform": patch
---

`SecretsVaultService.rotate` takes an optional `{ sourceOpener }` that reads the stored row after a key switch; `deps.sealer.open` always means "open with the current keyring". Every fresh seal (`put`, `prepare`, copy and `rotate`) is opened again with the service's own sealer before it can be written, so a sealer binding must satisfy `open(seal(x)) === x`: run `secretSealerContractViolations` from `@jini-ai/platform/secrets/testing` against each binding. A refused seal throws `VaultResealRefusedError` (still `VaultError` / `invalid-record`) naming the failing step, the key generation and the sealer error's name and code, and never an envelope, binding string or plaintext.
