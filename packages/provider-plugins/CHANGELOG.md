## 0.6.23

- Security hardening.

# @jini-ai/provider-plugins

## 0.6.22

- Rebuilt with core, diagnostics, plugins and ui 0.6.22: the Sentry and OpenTelemetry server bundles carry the current redaction, and bundled license records are current.

## 0.6.19

- ECharts pie and donut specs now draw every series as an equally wide concentric ring, preserving the donut hole, category palette, shared legend and series/category/value tooltips. Single-series options are unchanged; missing/null shares, negative shares and all-zero rings retain the core table fallback.
- Publishable again, for the providers with no package of their own: the browser chart providers. Exports `./charts-recharts/*` and `./charts-echarts/*` (each its own `plugins/<id>/` folder), `./package.json`, `./catalog` and `./plugins/*`; `files` lists only the two chart payloads. `build`/`prepack` type-check, then build both charts. Removed: the `./build` export (workspace tooling; pack tests import the builder from source). Recharts, React, ECharts, zrender and tslib are bundled into the artifacts and stay development dependencies. `catalog.json` lists only the two chart artifacts.
- The builder swaps only `plugins/<id>`, so building a second id into the same package keeps the first.
- The builder bundles each manifest-declared `browserProviders` script and stylesheet from the same `client/` path under the source (`.ts`/`.tsx` for scripts) for the browser (ESM, es2022, minified, `NODE_ENV=production`), refuses any remaining import (no Node-builtin allowance), retains bundled licenses, covers the assets in the integrity map and validates the declarations before staged publication.
- New browser-only provider source `charts-recharts` (`tovu/charts-recharts`, browser provider `plugin.recharts`, kinds bar, line and pie), restored from the deleted `@jini-ai/charts-recharts` workspace with Recharts 3.10.1 and React 19.2.7 pinned exactly. It carries the three fixes that were hand-patched into Tovu's shipped bundle: bar labels get their band less 4px and three lines on a 58px axis, so dock-width labels stop truncating; bar and line charts of whole counts get whole-number y ticks, `min(5, max(2, span + 1))` of them with the span measured from zero, so a largest count of 1 draws 0–1; fractional data keeps Recharts' defaults. Its server entry registers nothing. JSX is type-checked only through `tsconfig.charts.json`, and only `src/charts-*` tests run in jsdom.
- Recharts bar labels keep each " · " separator on the line of the word before it (a no-break space), so a narrow band never draws the dot alone on a line (Tovu 47b4199e0 patched the same symptom into its shipped bundle by binding the dot forward, which re-truncates the next word at ~300px).
- The artifact integration test covers browser-only sources. For each one it checks the packed declaration, `validateBrowserProviders`, client assets with no imports, a server entry that registers nothing, install and load with no server provider, host admission of the retained bytes, and a mount of the built bundle.
- New browser-only provider source `charts-echarts` (`jini/charts-echarts`, browser provider `plugin.echarts`, kinds bar, line, area, pie, donut, scatter and stacked-bar) on Apache ECharts 6.1.0, pinned exactly. It draws multi-series specs, axis names and `format`/axis number formats; scatter reads `categoryKey` as the numeric x and each series as a y; whole-number data gets whole ticks. It registers only the charts and components those kinds use, always renders SVG (never canvas) with ECharts' aria description on, paints with the host's `--jini-chart-*` tokens (palette defaults in its own stylesheet), and replaces series and axes on every update so a dropped series or a former kind leaves nothing behind. `supportsEChartsSpec` refuses what it would draw incompletely (unknown kinds, text or nested values, all-gap data, mismatched or negative or all-zero pie shares, non-numeric scatter x, malformed locales), so the host falls back to the next provider or the table. Its server entry registers nothing. The artifact integration test packs, admits and mounts its built bundle.

## 0.6.17

### Patch Changes

- Handle npm 12 pack JSON through the shared parser in artifact tests; align release-version fixtures with 0.6.17.

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
