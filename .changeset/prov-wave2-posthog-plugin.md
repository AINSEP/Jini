---
"@jini-ai/analytics": patch
"@jini-ai/provider-plugins": patch
---

The PostHog product-analytics adapter moved out of `@jini-ai/analytics` into the `analytics-posthog` provider plugin (contract `product_analytics`). Removed: the `@jini-ai/analytics/product/posthog` subpath and the optional `posthog-node` peer. `@jini-ai/analytics/product` is verified to bundle for a browser target with no Node builtin.
