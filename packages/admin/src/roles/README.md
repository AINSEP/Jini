# roles

The admin's Roles & Policies screen: the screen body, its sections and dialogs, the controller
hooks, the tab system, the rules and the dictionary. Only the host's HTTP client (`rolesApi`), its
`RolesPort` binding and its `ApiError` class stay with the host. Why the engine/host split is drawn
this way: [`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../ADS-memory/reports/jini-port/extraction-plan.md).

| file | what it is |
|---|---|
| `Roles.tsx` | The screen body: header, row-error banner, tab strip, the two tab panels and the three confirm dialogs. |
| `RolesSection.tsx`, `PoliciesSection.tsx`, `PolicyRow.tsx`, `PolicyPermissionForm.tsx`, `RoleConfirmDialogs.tsx` | The sections, rows and dialogs `Roles.tsx` composes. |
| `hooks/use-roles.hooks.ts` | `useRoles(deps)`, `RolesController`, `RolesDependencies`; composes `use-roles-state`, `use-roles-mutations` and the action factories (`roles-row-actions`, `roles-permission-actions`, `roles-controller`). |
| `Roles.hooks.tsx` | `ROLES_TAB_IDS`, `resolveRolesTabId`, `resolveRolesTabs`, and the two tab glyphs. |
| `rules.ts` | `KEYS`, the row-menu builders, and `describeApiError` (the screen's error-code copy over a host-injected `RolesApiErrorPort`). |
| `roles-i18n.ts` | The screen's dictionary `t`, merged from `i18n/roles-translations-{a,b,c}.ts` (per-locale-group parts, split only to stay under the file-size limit) over `ADMIN_COMMON_I18N`. |
| `i18n/roles-sentence-parts.ts` | Whole-sentence copy builders: page description and the three confirm-dialog bodies. |

The wire types (`AdminRole`, `AdminPolicy`, `AdminPolicyPermission`) have one owner:
`@jini-ai/core/contracts/site/user-management-react`. This folder does not re-declare them.

## Wiring

**Needs injected:** `useRoles(deps: RolesDependencies)` takes `port` (the `RolesPort` from
`@jini-ai/core/contracts/site/user-management-react`), `errors` (a `RolesApiErrorPort`: the host's
admin HTTP error class as `isApiError` and its default describer) and `useAdminLocale` (the host's
locale hook, REQUIRED). `Roles` takes `useRolesHook` (REQUIRED; the host composes `useRoles` with its
deps), `goToTab` (the host's `?tab=` navigation) and `usersHref` (the host's users route). The
list/mutation reads go through the kit facades `useFetchQuery`/`useFetchMutation` (`../react/kit.js`),
so the host mounts its `AdminKitProvider` and a `FetchQueryProvider`. `resolveRolesTabs({ t })` takes a
bound `Translate`. Tovu's binding: `features/roles/index.tsx`, `hooks/use-wired-roles.hooks.ts`,
`roles-host-binding.ts`. CSS: `jini-page`/`jini-card`/`jini-notice` family plus
`jini-roles-{list-table,table-scroll,muted-cell,integrations-form,form-measure,permission-list,permission-form-fields}`,
which the host styles.

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
