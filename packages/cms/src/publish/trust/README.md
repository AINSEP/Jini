# publish/trust

Zero-setup publishing trust. A publishing credential is derived from the install's existing site key, never issued or stored.

Architecture ADR: `ADS-memory/reports/jini-port/extraction-plan.md`.

## Wiring

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
