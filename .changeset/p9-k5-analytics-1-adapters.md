---
"@jini-ai/analytics": patch
---

`@jini-ai/analytics/site/jini-adapters` and `@jini-ai/analytics/site/salt` add the site ingest binding, local sink adapter and daily-salt wrapper; the HKDF wire context (`saltContext`) and the forward-failure reporter (`reportForwardFailure`) are REQUIRED host-injected fields on `AnalyticsIngestRouteDeps` (no package default).
