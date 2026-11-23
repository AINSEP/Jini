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

`agent-tools.ts` (`@jini-ai/devops/deploy/site/agent-tools`, universal). Provides `deploymentsAgentToolCatalog`, the model-facing catalog (names, prose, input schemas) for the deployment tools. **Needs injected**: nothing; the host pairs it with its own handlers and tool metadata.

`deploy-targets/types.ts` (`@jini-ai/devops/deploy/site/deploy-targets/types`, universal, types only). The host contract a deploy-target module (shipped in an agent plugin) is written against: registry, loaded-target, credential-spec and inspection shapes over `@jini-ai/devops/deploy`. **Must never import**: a vendor host implementation.

`dockerfile.ts` (`@jini-ai/devops/deploy/site/dockerfile`, node). Read/write of the repo-root `Dockerfile` with an etag-checked write (`writeDockerfileSourceWithIfMatch`). **Needs injected**: nothing, but it resolves the file against `process.cwd()`, so the host must run with its cwd at its repo root (see the file header).

`publish-credentials/execution-mode.ts` (`@jini-ai/devops/deploy/site/publish-credentials/execution-mode`, universal). `executionModeFromEnv({ env, envVarName })`. **Needs injected**: the environment object and the host-owned variable name; anything other than the literal `"hosted-api-only"` resolves to `"self-hosted-cli"`.

```ts
import { executionModeFromEnv } from "@jini-ai/devops/deploy/site/publish-credentials/execution-mode";
const publishExecutionMode = executionModeFromEnv({ env: process.env, envVarName: "MY_HOST_EXECUTION_MODE" });
```

`static-publish/types.ts` and `static-publish/domain-publish-rows.ts` (`@jini-ai/devops/deploy/site/static-publish/{types,domain-publish-rows}`, universal). The static-publish config/outcome/credential-source types and the pure `domainPublishRows` projection of a target inspection's domain plan. **Needs injected**: nothing.

`export-run.ts` (`@jini-ai/devops/deploy/site/export-run`, node). `createExportRunner({})` returns one single-flight export slot: `getExportRunSnapshot`, `startExportRun({ routeDeps, runExportSite, clean }, { basePath, productEvent, onSettled })`, `assertExportNotRunning({})` (throws `code: "ALREADY_RUNNING"`) and `diagnoseStaticExport({ routeDeps, runExportSite })` (a disposable export in a temp dir that reserves the same slot and restores the prior snapshot). **Needs injected**: the export engine (`runExportSite`, typed structurally as `ExportEngine`) and `routeDeps` carrying `clock` plus the host-resolved `exportOutputRootDir`; the optional product-event `tracker`. The host creates exactly ONE runner per process and hands it to both its admin export route and the deployments agent tools — two runners never share a slot, and separate OS processes are not covered (see the file header). **Must never import**: the export engine itself, `process.env`, or a host path.

```ts
import { createExportRunner } from "@jini-ai/devops/deploy/site/export-run";
export const { getExportRunSnapshot, startExportRun, assertExportNotRunning, diagnoseStaticExport } = createExportRunner({}); // host binding module, once per process
```
