# roles

The host-neutral half of the admin's Roles & Policies screen. Today this folder holds the leaf
slice only: the tab system, the rules and the dictionary. The screen itself (`Roles`, its sections, dialogs,
controller hooks, rules and dictionary) still lives in the host until its prerequisites land (the
host's admin HTTP client, and a size-policy home for the locale dictionary). Why the engine/host
split is drawn this way: [`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../ADS-memory/reports/jini-port/extraction-plan.md).

| file | what it is |
|---|---|
| `Roles.hooks.tsx` | `ROLES_TAB_IDS`, `resolveRolesTabId`, `resolveRolesTabs`, and the two tab glyphs. |
| `rules.ts` | `KEYS`, the row-menu builders, and `describeApiError` (the screen's error-code copy over a host-injected `RolesApiErrorPort`). |
| `roles-i18n.ts` | The screen's dictionary `t`, merged from `i18n/roles-translations-{a,b,c}.ts` (per-locale-group parts, split only to stay under the file-size limit) over `ADMIN_COMMON_I18N`. |
| `i18n/roles-sentence-parts.ts` | Whole-sentence copy builders: page description and the three confirm-dialog bodies. |

The wire types (`AdminRole`, `AdminPolicy`, `AdminPolicyPermission`) have one owner:
`@jini-ai/core/contracts/site/user-management-react`. This folder does not re-declare them.

## Wiring

**Needs injected:** a bound `Translate` (`@jini-ai/core/text`) passed as `resolveRolesTabs({ t })` — the
host's roles dictionary stays with the host, so the labels are translated by whatever `t` the host
binds. The `?tab=` navigation is the host's too: the host binds the tab strip's `onChange` to its
own router call (Tovu: `features/roles/roles-host-binding.ts`, with `replace: true`). `describeApiError`
needs a `RolesApiErrorPort` as its `errors` field: the host's admin HTTP error class (as
`isApiError`) and its shared default describer. No hook,
port or provider is read from inside this folder.

**Provides:** the tab descriptors in the kit's `TabBarTab` shape and a `?tab=` guard that falls
back to `roles`.

```tsx
import type { AdminRole } from "@jini-ai/core/contracts/site/user-management-react";
import { resolveRolesTabId, resolveRolesTabs } from "@jini-ai/admin/roles/Roles.hooks";

// in the host's Roles screen, with `t` bound by the host's own roles dictionary
const activeTab = resolveRolesTabId({ tabId: new URLSearchParams(location.search).get("tab") });
<TabBar tabs={resolveRolesTabs({ t })} activeId={activeTab}
  onChange={(tabId) => hostGoToRolesTab({ tabId })} ariaLabel={t("Roles & Permissions")} />
```

**Must never import:** the host's HTTP client or its `ApiError`, the host's locale hook or
dictionaries, any other `@jini-ai/*` package's implementation (the kit facade in `../react/kit.js`
is the only route to UI types), or server-framework types.
