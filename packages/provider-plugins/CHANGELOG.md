# @jini-ai/provider-plugins

## 0.6.13

### Patch Changes

- e46b6ec: The Langfuse AI-trace sink moved out of `@jini-ai/agent-runtime` into the `ai-trace-langfuse` provider plugin (contract `ai_trace`), which bundles the `langfuse` SDK. Removed: the `@jini-ai/agent-runtime/ai-trace/langfuse` subpath (`createLangfuseAiTraceSink`, `loadLangfuseAiTraceSink`, `toLangfuseCall`). The runtime core has no Langfuse reference; a core-wide boundary test refuses vendor SDK imports or dependencies in any other package.
- 63bacc5: OpenTelemetry and Sentry observability adapters moved out of `@jini-ai/diagnostics` into the `observability-opentelemetry` and `observability-sentry` provider plugins of `@jini-ai/provider-plugins`. Removed: the `@jini-ai/diagnostics/observability/opentelemetry` and `/observability/sentry` subpaths and every `@opentelemetry/*` / `@sentry/node` dev and optional peer dependency. The OTel plugin accepts any OTLP/HTTP endpoint plus generic request headers. Packages bundled into plugin artifacts now ship their LICENSE file.
- 212cf50: The PostHog product-analytics adapter moved out of `@jini-ai/analytics` into the `analytics-posthog` provider plugin (contract `product_analytics`). Removed: the `@jini-ai/analytics/product/posthog` subpath and the optional `posthog-node` peer. `@jini-ai/analytics/product` is verified to bundle for a browser target with no Node builtin.
- 31819c8: The Stripe `PaymentsProvider` adapter moved unchanged out of `@jini-ai/capability-providers` into the `payments-stripe` provider plugin (move only: commerce's payment contract is canonical, conversion is deferred, and no host selects or activates it). Removed: the `@jini-ai/capability-providers/adapters/stripe` subpath. The hardwiring check treats `provider-plugins/` sources as provider adapters.
- 63342e9: The PostHog, Sentry, OpenTelemetry and Langfuse provider plugins show short display names ("PostHog", "Sentry", "OpenTelemetry", "Langfuse") instead of "<vendor> <category> provider".
- 4a9d6ca: Provider factories accept a neutral host `attribution` input (`attributes`, `groups`, `tags`; the host names the keys): OTel adds the attributes to every span's resource (`service.name` stays the host's), PostHog adds them to every event's properties (not overridable by the event) plus `$groups`, Langfuse adds them to trace metadata and appends the tags.
- 1f2464f: Add admitted server-provider factory contributions and generation-scoped resource disposal to the
  existing plugin host. Introduce one self-contained provider artifact distribution with a tiny
  fixture, integrity maps, bundled license texts, and build-on-pack support.
  Pending initialization settles on retirement or a configurable `initializeTimeoutMs`, so a
  hung factory cannot block boot or shutdown; shutdown also awaits in-flight direct lease disposal.
- 146be48: `ai-trace-langfuse`: a host-supplied (borrowed) client is never shut down by the provider; dispose and the sink's `shutdown` only flush it. A factory-built client is still shut down on dispose.
- 839dba9: `observability-opentelemetry`: the OTLP exporter, sampler, span limits and batch settings come from injected configuration only; standard `OTEL_*` environment variables (headers, endpoint, compression, sampler, resource attributes) no longer change what the plugin exports or where.
- 223fc22: Provider declarations may declare `settings` (public and secret fields, `name` = factory input key) so a host can render its secure settings card and decide "configured?" without executing plugin code. The OTel, Sentry, PostHog and Langfuse provider plugins declare theirs; the OTel factory also accepts the OTLP `Name=Value,…` header text and defaults `tracerName` to `serviceName`.
- 106d9dd: Provider settings fields can declare a `default`, `options` (a select of `{ value, label }`) and `allowCustom` (free text beside the options); public fields only. PostHog and Langfuse declare their cloud regions (PostHog US by default, Langfuse EU); OpenTelemetry takes a username/instance ID + token and builds `Authorization: Basic` (or `Bearer` with no username) itself, keeping raw extra headers as an advanced field (a card saved with raw headers still applies).

Release notes are maintained by Changesets.
