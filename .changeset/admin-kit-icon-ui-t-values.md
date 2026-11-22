---
"@jini-ai/admin": minor
---

The admin kit (`@jini-ai/admin/react/kit`) gains three host-injected entries so moved screens import no UI package: an `Icon` component slot (`IconProps`, with `name` typed as the closed `KitIconName` subset of the host's icon names, never a general string), a `useT` hook facade for the UI library's translator (`KitTranslator`), and a required `values` group (`AdminKitValues`: `SETTINGS_DIALOG_DICTIONARIES`, `DEFAULT_NOTIFICATIONS_PREFERENCES`, `UNREACHABLE_RETRY_DELAYS_MS`, `LOCAL_BACKUP_PRINCIPAL_ID`) read with `useAdminKitValues()`. Hosts add `components.Icon`, `hooks.useT` and `values` to their `satisfies AdminKit` assignment; `fakeAdminKit()` supplies neutral stand-ins.
