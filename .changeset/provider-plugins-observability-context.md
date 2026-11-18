---
"@jini-ai/provider-plugins": minor
---

The OpenTelemetry, Sentry and PostHog providers no longer import `@jini-ai/diagnostics`: they read diagnostics' helpers from `optional.context` (the `observabilityProviderContract` descriptor), the OTel span scope from `optional.scope`, and PostHog's failure classifier from `optional.describeTelemetryFailure`, and fail at initialize with a typed configuration error when one is missing. The chart providers take the theme applier from the mount input (`applyTheme`) instead of importing `@jini-ai/ui`.
