---
"@jini-ai/plugins": patch
"@jini-ai/provider-plugins": patch
---

Provider declarations may declare `settings` (public and secret fields, `name` = factory input key) so a host can render its secure settings card and decide "configured?" without executing plugin code. The OTel, Sentry, PostHog and Langfuse provider plugins declare theirs; the OTel factory also accepts the OTLP `Name=Value,…` header text and defaults `tracerName` to `serviceName`.
