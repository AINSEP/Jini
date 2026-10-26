---
"@jini-ai/provider-plugins": patch
---

`observability-opentelemetry`: the OTLP exporter, sampler, span limits and batch settings come from injected configuration only; standard `OTEL_*` environment variables (headers, endpoint, compression, sampler, resource attributes) no longer change what the plugin exports or where.
