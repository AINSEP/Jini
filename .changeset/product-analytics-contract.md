---
"@jini-ai/analytics": minor
---

`@jini-ai/analytics/product`: a vendor-neutral product-analytics contract (`capture({ name, userId, properties })`, `identify({ userId, traits })`, shared frozen noop) and `withProductAnalyticsGuards` (per-event consent, pseudonymous ids, the shared PII property check plus secret redaction). `@jini-ai/analytics/product/posthog`: a PostHog provider over `posthog-node` (optional peer, 5.55.1) returning `{ port, dispose }`, GeoIP and exception autocapture off.
