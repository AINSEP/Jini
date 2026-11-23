# deploy/site

Host-neutral site-deploy domain types and helpers moved out of a host product (see `extraction-plan.md`).

Architecture ADR: `ADS-memory/reports/jini-port/extraction-plan.md`.

## Wiring

`publish-credentials/types.ts` (`@jini-ai/devops/deploy/site/publish-credentials/types`, universal, types only).

- **Needs injected**: nothing at runtime. The host's credential store produces `PublishCredentialSummary` rows and validates `PublishConnectionInput` values against its deploy-target descriptors.
- **Provides**: `PublishProviderId` (the id of a `DeployTargetDescriptor`), `PublishConnectionInput` (provider id plus flat string fields, sealed as one blob), `PublishCredentialSummary` (the read model: no field can carry a token or a sealed value), `PublishCredentialScope`.
- **Must never import**: a store, sealer or keyring implementation, another `@jini-ai/*` package's implementation (`@jini-ai/core` contracts and this package's `deploy/target-contracts` only), or a host path.

```ts
import type { PublishConnectionInput, PublishCredentialSummary } from "@jini-ai/devops/deploy/site/publish-credentials/types";

declare function listCredentials(): Promise<readonly PublishCredentialSummary[]>; // host store
const connection: PublishConnectionInput = { providerId: "any-host", token }; // validated + sealed by the host store
const needsHeal = (await listCredentials()).filter((c) => c.accountLabel === null);
```
