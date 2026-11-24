---
"@jini-ai/admin": patch
---

Database screen: add the screen rules, the database dictionary (split per locale group), the three section ports and the `useTimelineSection` / `useSchemaStateSection` / `useMigrateForwardSection` hooks, plus `AdminSchemaState` (and its drift-status/snapshot types) in `@jini-ai/admin/core`. The host injects its locale hook, API-error wording and cursor-pages hook through a `host` object; `navigateToRecoveryWithDeepLink` takes the router's `navigate` and `viewInRecoveryAccessibleName` the viewer's time zone.
