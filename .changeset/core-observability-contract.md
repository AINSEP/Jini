---
"@jini-ai/core": minor
"@jini-ai/diagnostics": major
"@jini-ai/analytics": major
"@jini-ai/daemon": patch
"@jini-ai/http-kit": patch
"@jini-ai/provider-plugins": patch
---

The observability contract moves into `@jini-ai/core/contracts/observability`: the request, db, outbound, agent-run and operation tracker types, `ObservabilityPort`/`ObservabilityAdapter`, the `Product*` analytics port types, `BrowserAnalyticsContribution`, and `createNoopObservabilityPort`/`isNoopObservabilityPort` (now one shared frozen noop port). `@jini-ai/diagnostics/observability` and `@jini-ai/analytics/product` no longer export those names; import them from core. The daemon, http-kit and OpenTelemetry provider drop their structural restatements and take the core port types.
