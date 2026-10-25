# @jini-ai/provider-plugins

One asset distribution of ordinary tier-3 Jini server plugins. There are no callable adapter exports:
hosts install and load the artifacts. Vendor SDKs are bundled into each artifact at build time and
never become dependencies or peers of a core `@jini-ai/*` package.

| plugin id | provider (`contract` / `id`) | factory `required` input | factory `optional` input |
|---|---|---|---|
| `fixture-provider` | `fixture` / `fixture` | `{ value }` | — (conformance fixture) |
| `observability-opentelemetry` | `observability` / `opentelemetry` | `{ serviceName, tracerName, endpoint?, tracesEndpoint?, headers? }` — any OTLP/HTTP endpoint; credentials ride `headers` | `{ spanProcessors? }` (tests) |
| `ai-trace-langfuse` | `ai_trace` / `langfuse` | `{ publicKey, secretKey, baseUrl?, environment?, release? }` | `{ client? }` (tests) |
| `analytics-posthog` | `product_analytics` / `posthog` | `{ apiKey, host }` | `{ fetch?, flushAt? }` (tests) |
| `observability-sentry` | `observability` / `sentry` | `{ dsn, environment?, tracesSampleRate? }` (rate default 0) | `{ client?, transport? }` (host-owned client is never closed) |

Observability factories return diagnostics' `ObservabilityPort` plus `dispose`; `analytics-posthog`
returns `@jini-ai/analytics/product`'s `ProductAnalyticsPort`, which the host wraps in
`withProductAnalyticsGuards` (consent, opaque ids, PII rules) before any event reaches the vendor;
`ai-trace-langfuse` returns an `@jini-ai/agent-runtime/ai-trace` sink, which the host combines with
`createFanOutAiTraceSink` and hands to the daemon's `withAiTracing`.

Licenses: each artifact carries `licenses/<package>/` for every bundled package. A package that
ships no license file takes a bundled sibling's text from the same repository and declared license,
or a reviewed upstream copy under `license-supplements/<repository>/` (with a `SOURCE` note); the
build fails otherwise. Two configured observability
providers fan out through diagnostics' existing fan-out. Inputs come from the host's secure plugin
settings; never from manifests, browser assets or agent instructions.

`pnpm --filter @jini-ai/provider-plugins build` produces `catalog.json` and
`plugins/<id>/<version>/{jini.plugin.json,server/index.mjs,licenses/**}`. `pnpm pack` builds these
assets through `prepack`. esbuild bundles runtime dependencies, permits only Node builtins as
external imports, retains bundled packages' license/notice files, and the existing installer
integrity helper hashes every packaged file except the manifest. SDK packages are build-time
(dev) dependencies of this distribution, never runtime dependencies of an installed artifact.

Hosts read the catalog, install selected plugin folders with `previewSitePluginInstall` /
`installSitePlugin`, and use the existing `loadPlugin` with explicit tier admission. Supply
`providerContributions: { registry, isSelected }`; selection must require installed, enabled,
and configured state. Recheck selection when settings change. Detach the plugin's contribution
snapshot on disable/quarantine. Only admitted snapshots can initialize factories through
`createPluginProviderHost`. Await initialization before admitting application work, and dispose
that host on shutdown or failed boot. Unselected contracts keep the domain's existing noop.

Factories accept explicit configuration, credentials and borrowed effect ports as required object
inputs, plus an optional object, and return `{ port, dispose }`. Setup only registers factories.
The injected domain validator checks returned ports through core's `createProviderRegistry`.
A lease's `isCurrent({})` guards new work after replacement. Retirement releases resources with
idempotent, bounded, independent teardown; pending factories release their late results on arrival.
A teardown timeout bounds waiting and cannot forcibly interrupt arbitrary in-process code.

The fixture supports SDK `0.1.x` and `1.x`, and declares one publisher identity for two example
host identity namespaces. Tier-3 plugins execute trusted code in process; capability gating governs
supplied SDK handles and does not sandbox arbitrary Node code. No secrets belong in manifests.
