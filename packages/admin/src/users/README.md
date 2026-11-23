# users

The admin Users screen's dictionary. The screen body, its controller hooks and its rules live in
`@jini-ai/user-management` (`src/react/users/`); the dictionary lives here instead because it is built
with `translationEntry`/`mergeLocaleOverlays` from `../shell/lib/`, and `@jini-ai/user-management` may
not import `@jini-ai/admin` (package layer rule). Why the engine/host split is drawn this way:
[`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../ADS-memory/reports/jini-port/extraction-plan.md).

| file | what it is |
|---|---|
| `users-i18n.ts` | The screen's dictionary `t`, merged from `i18n/users-translations-{a,b,c,d}.ts` plus the Owner, password-field and reset-password-info overlays, over `ADMIN_COMMON_I18N`. |
| `i18n/users-translations-{a,b,c,d}.ts` | Per-locale-group parts of the base dictionary (es…pt-BR, ru…pl, hu…it, hi…bn), split only to stay under the file-size limit; content verbatim. |

## Wiring

**Needs injected:** nothing. `t({ locale, key })` is a pure lookup; the host binds it to its locale
hook and passes the bound translator into the users controller (`useLocalizedUsers` in
`@jini-ai/user-management/react` takes it as `t`). Tovu's binding:
`apps/admin/src/features/users/hooks/use-wired-users.hooks.ts`.

**Provides:** `t` from `@jini-ai/admin/users/users-i18n`. A key this dictionary misses falls back to
`ADMIN_COMMON_I18N`, then to the English source string. Product copy never enters this dictionary;
the only host-owned common entry (the publish dialog's older-destination notice) is not used here.

```ts
import { t } from "@jini-ai/admin/users/users-i18n";

t({ locale: "es", key: "Users" }); // "Usuarios"
```
