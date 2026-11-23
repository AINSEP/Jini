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

`publish-credentials/account-label-heal-scheduler.ts` (`@jini-ai/devops/deploy/site/publish-credentials/account-label-heal-scheduler`, universal).

- **Needs injected**: `AccountLabelHealSchedulerDeps` — `heal({ id })` (the host's verify-then-persist pass for one credential row, returning a Promise) and `onHealError({ id, err })` (required: the package never logs, so the host binds its own reporter; it is also called with id `"*"` if reporting itself throws). `idsNeedingAccountLabelHeal` takes the host's `canYieldAccountLabel(providerId)` predicate.
- **Provides**: `idsNeedingAccountLabelHeal` (rows with a null `accountLabel` on a provider that can yield one) and `createAccountLabelHealScheduler` → `AccountLabelHealScheduler.triggerFor(ids)`: fire-and-forget, at most one heal in flight per id, never throws or rejects into the caller.
- **Must never import**: the host's provider-verify module (it imports this feature, so that would be a cycle), a logger or `console`, or another `@jini-ai/*` package's implementation.

```ts
import { createAccountLabelHealScheduler, idsNeedingAccountLabelHeal } from "@jini-ai/devops/deploy/site/publish-credentials/account-label-heal-scheduler";

// Build once per route registration, so the in-flight dedupe survives between requests.
const scheduler = createAccountLabelHealScheduler({
  heal: verifyAfterSave, // host: probe the provider, then persist the label
  onHealError: ({ id, err }) => hostLogger.error({ id, err }), // host-owned reporter
});
// In the human-gated list handler, after the response is sent:
scheduler.triggerFor(idsNeedingAccountLabelHeal({ credentials, canYieldAccountLabel }));
```
