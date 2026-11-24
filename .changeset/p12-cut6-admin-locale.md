---
"@jini-ai/admin": minor
---

Add `useAdminLocale` at `@jini-ai/admin/shell/hooks/use-admin-locale.hooks`, taking its port, boot scope, query hooks, key prefix and fallback locale from the host, and the required `AdminKitHooks.useAdminLocale` slot with its `UseAdminLocaleHook` type. Breaking: `AdminLocalePort.loadLanguage` now takes `(required: {}, optional?)` and `subscribeToSettingsRefresh` accepts an optional second object; hosts update their binding, and every `AdminKit` literal must supply `hooks.useAdminLocale`.
