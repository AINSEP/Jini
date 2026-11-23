# roles

The host-neutral half of the admin's Roles & Policies screen. Today this folder holds the leaf
slice only: the wire types and the tab system. The screen itself (`Roles`, its sections, dialogs,
controller hooks, rules and dictionary) still lives in the host until its prerequisites land (the
host's admin HTTP client, and a size-policy home for the locale dictionary). Why the engine/host
split is drawn this way: [`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../ADS-memory/reports/jini-port/extraction-plan.md).

| file | what it is |
|---|---|
| `api/roles-api.types.ts` | `AdminRole`, `AdminPolicy`, `AdminPolicyPermission` — the wire shapes the roles endpoints return. Type-only. |
| `Roles.hooks.tsx` | `ROLES_TAB_IDS`, `resolveRolesTabId`, `resolveRolesTabs`, `goToRolesTab`, and the two tab glyphs. |

## Wiring

**Needs injected:** a bound `Translate` (`@jini-ai/core/text`) passed to `resolveRolesTabs` — the
host's roles dictionary stays with the host, so the labels are translated by whatever `t` the host
binds. No hook, port or provider is read from inside this folder.

**Provides:** the wire types above; the tab descriptors in the kit's `TabBarTab` shape; a
`?tab=` guard that falls back to `roles`; `goToRolesTab`, which navigates through this package's
own `shell/lib/router` with `replace: true`.

```tsx
import type { AdminRole } from "@jini-ai/admin/roles/api/roles-api.types";
import { goToRolesTab, resolveRolesTabId, resolveRolesTabs } from "@jini-ai/admin/roles/Roles.hooks";

// in the host's Roles screen, with `t` bound by the host's own roles dictionary
const activeTab = resolveRolesTabId({ tabId: new URLSearchParams(location.search).get("tab") });
<TabBar tabs={resolveRolesTabs(t)} activeId={activeTab}
  onChange={(tabId) => goToRolesTab({ tabId })} ariaLabel={t("Roles & Permissions")} />
```

**Must never import:** the host's HTTP client or its `ApiError`, the host's locale hook or
dictionaries, any other `@jini-ai/*` package's implementation (the kit facade in `../react/kit.js`
is the only route to UI types), or server-framework types.
