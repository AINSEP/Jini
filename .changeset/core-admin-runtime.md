---
"@jini-ai/core": minor
"@jini-ai/admin": minor
---

The pure admin module runtime moves to `@jini-ai/core/admin-runtime`, where a module owner may import it: `createControllerStore` (and the `ControllerStore` / `WritableControllerStore` types), `AdminConfigError`, `AdminApiError`, `describeApiError`, `querySuffix`, `hasPermission`, `isPanelAccessible`, `withoutInaccessiblePanels`.

`@jini-ai/admin` no longer exports `AdminApiError`, `describeApiError`, `hasPermission`, `isPanelAccessible`, `withoutInaccessiblePanels` (from `@jini-ai/admin/core`) nor `AdminConfigError` (from `@jini-ai/admin/core/module`); import them from `@jini-ai/core/admin-runtime`. `querySuffix` now takes `{ query }`. `withoutInaccessiblePanels` is generic over the nav group type, so a host's own group type is returned unchanged.
