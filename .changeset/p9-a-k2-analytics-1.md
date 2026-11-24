---
"@jini-ai/admin": patch
---

Move the host's Analytics admin screen: `./screens/analytics` (`Analytics`, which takes its controller hook as the required `useAnalyticsHook` prop), `./screens/analytics/analytics-i18n` (the 21-locale dictionary over `ADMIN_COMMON_I18N`), `./screens/analytics/api/analytics-api.types`, and the `useAnalytics` hook, `AnalyticsPort` type and `createFakeAnalyticsPort` fake under `./screens/analytics/hooks/*`, with their tests.
