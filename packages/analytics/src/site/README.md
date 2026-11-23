# analytics/site

Host-facing analytics seams moved from a site host: the site ports and error classes
(`ports.ts`), the agent tool catalog (`agent-tools.ts`), and the visitor/browser analytics
contracts the public beacon route is typed against (`contracts.ts`), the per-request vendor
forwarding / plugin `beforeIngest` wiring (`forwarding.ts`), the ingest route binding and local sink
adapter (`jini-adapters.ts`), and the daily-salt wrapper (`salt.ts`). Ingestion, normalization and the
buffer stay in the package root (`../ingest.ts`, `../salt.ts`).

## Wiring

- **Needs injected:** nothing at import time. `VisitorAnalyticsDeps<Request>` lists the host ports
  a route receives: `tracker` / `visitorTracker` (`Tracker`), `idGen`, `visitorAnalyticsProof`
  (returns a `ConsentAnalyticsProof` or `undefined`) and `visitorAnalyticsDeliveryAllowed`. All are
  optional; a missing proof or id generator denies capture. `BrowserAnalyticsSource` is the host's
  per-surface (`site` | `admin`) list of `BrowserAnalyticsContribution`s.
- **Forwarding needs injected (`./site/forwarding`):** a REQUIRED `warn: (message: string) => void`
  on `cacheAnalyticsProviders`, `createAnalyticsForwarding` (`AnalyticsForwardingRequired<R>`) and
  `createPluginAnalyticsHooks`. Messages are plain (no prefix, never key material); the host owns
  the console and any `[analytics]` prefix. Also `config` (`AnalyticsConfigPort`), `loadProviders`
  (`AnalyticsProviderSet`), `consentAllowsAnalytics`, `resolveCredential`, `httpClient`.
- **Ingest binding needs injected (`./site/jini-adapters`):** two REQUIRED fields on
  `AnalyticsIngestRouteDeps`: `saltContext` (`AnalyticsSaltContext`, the host's HKDF wire context —
  a hash input, so the host defines it byte-identically and this package never does) and
  `reportForwardFailure` (`AnalyticsForwardReport`, receives `{ forwarderId, outcome, message }`;
  the host owns the console line). `./site/salt`'s `deriveDailySalt` takes the same `saltContext`.
- **Tools and settings (`./site/tool-registrations`, `./site/config.settings`):** nothing beyond
  their args. `AnalyticsToolDeps` is `{ authorize, workspaceId, analyticsSink }`; the settings
  registrar and `createSettingsAnalyticsConfig` take the `@jini-ai/core/settings` ports
  (`EnsureSettingDefinitionsDeps`, `SettingsRepoPort`).
- **Provides:** `./site/contracts` (types), `./site/ports`, `./site/agent-tools`, `./site/forwarding`,
  `./site/jini-adapters` (`createAnalyticsIngestBinding`, `createLocalAnalyticsSink`,
  `analyticsPrivacyPolicy`, `AnalyticsIngestRouteDeps`), `./site/salt` (`deriveDailySalt`).

```ts
import type { VisitorAnalyticsDeps, BrowserAnalyticsSource } from "@jini-ai/analytics/site/contracts";

const browserAnalytics: BrowserAnalyticsSource = ({ surface }) => providers.forSurface(surface);
const visitor: VisitorAnalyticsDeps<Request> = {
  tracker, idGen,
  visitorAnalyticsProof: ({ request }) => consent.proofFor(request),
  visitorAnalyticsDeliveryAllowed: ({ proof }) => consent.stillValid(proof),
};

// Forwarding: the host passes its own reporter (here it keeps an `[analytics]` line prefix).
const warn = (message: string) => hostLog.warn(`[analytics] ${message}`);
const load = cacheAnalyticsProviders({ load: loadPluginProviders, clock, warn });
const forwarders = createAnalyticsForwarding({ workspaceId, config, loadProviders: load, consentAllowsAnalytics, resolveCredential, httpClient, warn });
const hooks = createPluginAnalyticsHooks({ loadProviders: load, warn });

// Ingest binding: the host supplies its HKDF wire context and forward-failure reporter.
const ingestDeps: AnalyticsIngestRouteDeps<Request> = {
  clock, ids, sink, config, resolveWorkspaceForHost, analyticsSeed,
  saltContext: hostSaltContext, // { extractionSalt: "<host constant>", infoPrefix: "analytics-salt:" }
  reportForwardFailure: ({ forwarderId, outcome, message }) => hostLog.warn(`[analytics] forward to '${forwarderId}' ${outcome}: ${message}`),
};
const { deps, optional } = createAnalyticsIngestBinding({ deps: ingestDeps }, { forwarders: await forwarders({ request }) });
```

- **Must never import:** a host module, an HTTP framework type, a logger, or another `@jini-ai/*`
  package other than `@jini-ai/core` (seam types come from `@jini-ai/core/contracts/site/*`).
  Package boundaries: `docs/decisions/DR-005-portable-package-boundaries.md`.
