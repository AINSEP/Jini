# react/users

The Users screen: the generic panel (`Users`, `UserManagePanel`, dialogs, row parts), its controller
hooks, account rules (`rules.ts`) and the locale-bound host composition.

| file | what it is |
|---|---|
| `Users.tsx`, `UsersTable.tsx`, `UsersDialogs.tsx`, `UserRowParts.tsx`, `ChangeUsernameDialog.tsx` | Markup. |
| `hooks/use-users.hooks.ts` (+ `use-users-*`, `users-*`) | Screen state over an injected `UsersPort`. |
| `hooks/use-localized-users.hooks.ts` | `useLocalizedUsers`: binds a host locale hook, scope, translator and navigate onto `useUsers`. |
| `UsersPanel.tsx`, `UsersPanel.hooks.ts` | `UsersPanel`: mounts `Users` from a host's wired controller hook. |
| `password-reset-notice.ts` | `passwordResetNotice`: the reset toast sentence per locale. |

## Wiring

**Needs injected:** `useLocalizedUsers(deps)` takes `port` (`UsersPort` from
`@jini-ai/core/contracts/site/user-management-react`), `useAdminLocale` (the host's locale hook,
REQUIRED), `queryScope` (the host's workspace id), `t` (the host's users dictionary translator,
`DictionaryTranslator` from `@jini-ai/core/text`) and optional `navigate`/`openOwnPasswordReset`. `UsersPanel` takes
`useUsersHook` (REQUIRED: the host's zero-argument wired composition of `useLocalizedUsers`),
`port`, `queryScope`, `renderServerLabel` (the host's status-label renderer) and
`openOwnPasswordReset`. The host mounts `FetchQueryProvider` and `UserManagementKitProvider`.
The users dictionary itself stays host-side for now: its `translationEntry`/`mergeLocaleOverlays`
helpers live in `@jini-ai/admin`, which this package may not import (L5 injection gate).
Tovu's binding: `apps/admin/src/features/users/{index.tsx,users-host-binding.ts,hooks/use-wired-users.hooks.ts}`.
CSS: no classes of its own beyond the `Users` screen's existing `jini-*` family.

**Must never import:** the host's HTTP client, locale hook, router or dictionaries, or
server-framework types.
