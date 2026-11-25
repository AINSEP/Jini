# publish/trust

Zero-setup publishing trust. A publishing credential is derived from the install's existing site key, never issued or stored.

Architecture ADR: `ADS-memory/reports/jini-port/extraction-plan.md`.

## Wiring

`session.ts` (`@jini-ai/cms/publish/trust/session`, runtime `node`: it uses `node:crypto`).

- **Needs injected**: a `KeyringPort` (`@jini-ai/core/contracts/vault`; only `derive` is called, under its own `publish-trust-session-key` purpose), the destination `workspaceId`, and a `clock`.
- **Provides**: `mintPublishSession`, `verifyPublishSession` (never throws; MAC compared constant-time before the payload is parsed, then expiry, audience, workspace), `SESSION_TTL_MS`.

`keys.ts` (`@jini-ai/cms/publish/trust/keys`, runtime `node`: it uses `node:crypto`).

- **Needs injected**: a `KeyringPort` (`@jini-ai/core/contracts/vault`). Only `derive` is called; the keyring must bind `purpose`, workspace and `info` into the HKDF input so the two derivations stay domain-separated.
- **Provides**: `deriveInstallationId`, `derivePublishSigningKey` (a `PublishSigningKey` whose `sign` closes over the private key), `publishPrincipalIdFor`, `PUBLISH_PRINCIPAL_ID_PREFIX`, `verifyPublishSignature` (fail-closed; the crypto effect is injectable through its `optional.verifyDecoded`).
- **Must never import**: another `@jini-ai/*` package's implementation (core types and contracts only), a host path, a logger or `console`. Never serialize a `PublishSigningKey`; only `publicKeyB64u` and a signature may leave the machine.
- **Frozen values**: the HKDF purposes (`publish-trust-installation-id`, `publish-trust-signing-key`), the `pub:` principal prefix and the `${installationId}:${targetOrigin}:v${generation}` info layout are identity. Renaming one re-identifies every install and breaks every existing connection; `__tests__/keys.test.ts` pins the derived bytes.

```ts
import { deriveInstallationId, derivePublishSigningKey, verifyPublishSignature } from "@jini-ai/cms/publish/trust/keys";

const sourceInstallationId = await deriveInstallationId({ keyring, workspaceId });
const key = await derivePublishSigningKey({ keyring, workspaceId, sourceInstallationId, targetOrigin, generation: 1 });
const signatureB64u = key.sign({ message });
const ok = verifyPublishSignature({ publicKeyB64u: key.publicKeyB64u, message, signatureB64u });
```

### Grant, provisioning and revocations

`grant.ts`, `provisioning.ts`, `provisioning-status.ts`, `revocations.ts` (runtime `universal`) and `provisioning.node-io.ts` (runtime `node`: `node:fs`).

- **The host owns, and passes in**: the env var NAME that overrides the committed grant file. The host reads its own env and hands `resolvePublishTrust({ envValue, fileContents })` the raw value: `undefined` when the variable is unset, `""` when it is set but empty. `""` is a revocation (state `revoked`, origin `env`) that overrides the file, so an operator with only provider access can switch publishing off; treating it as unset would fall back to the file and fail OPEN. `__tests__/provisioning.test.ts` pins this. `describePublishTrustState({ res, settingName })` and `describeConnection({ ..., settingName })` take the same name, only to print it in the env-revoked sentence.
- **The host owns**: the committed-config root (an absolute directory; `PUBLISH_TRUST_CONFIG_PATH` is repo-relative and joined to it by the host), the revocation store binding, and the clock.
- **Provides**: grant parsing and the capability/route predicates (`grant.ts`), the grant-document codec, merge rules, resolution and the file-provisioning port (`provisioning.ts`), plain-sentence status (`provisioning-status.ts`), the revocation document, store port and publish admission (`revocations.ts`), and `nodeProvisioningFileIo`, the atomic-rename file IO (`provisioning.node-io.ts`).
- **Must never**: read `process.env` or name an env var.
