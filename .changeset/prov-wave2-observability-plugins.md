---
"@jini-ai/diagnostics": patch
"@jini-ai/provider-plugins": patch
"@jini-ai/core": patch
"@jini-ai/analytics": patch
"@jini-ai/agent-runtime": patch
"@jini-ai/protocol": patch
---

OpenTelemetry and Sentry observability adapters moved out of `@jini-ai/diagnostics` into the `observability-opentelemetry` and `observability-sentry` provider plugins of `@jini-ai/provider-plugins`. Removed: the `@jini-ai/diagnostics/observability/opentelemetry` and `/observability/sentry` subpaths and every `@opentelemetry/*` / `@sentry/node` dev and optional peer dependency. The OTel plugin accepts any OTLP/HTTP endpoint plus generic request headers. Packages bundled into plugin artifacts now ship their LICENSE file.
