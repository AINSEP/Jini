Spec ID: SPEC-JINI-USER-MANAGEMENT-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:00c89a8c35204fa658487a5bd8e882dce96282aa15e296af32260dbee7779d5b
spec_mode: reverse_spec


# User management UI contract

## Consumer wiring and component surface

Roles/policies are composed through `@jini-ai/user-management/admin/react`; see
[the current roles contract and cleanup](../../src/admin/PORT.md). The superseded standalone
roles screens and their presentation-controller exports were removed on 2026-10-03.
The remaining standalone screens below keep their existing wiring.

Import components/hooks/types from `@jini-ai/user-management/react`; import fakes from `/react/testing`. Supply workspace/actor-bound ports and `Translate` from `@jini-ai/ui/panel-kit`. Users requires its `FetchQueryProvider` and a host/workspace/actor-specific `queryScope`. Login and Members use local hook state. No component chooses an HTTP transport.

| Component | Required props | Optional props |
|---|---|---|
| `Login` / `LoginProps` | `port: LoginPort; translate: Translate; productName: string; onLogin: (user: AdminUser) => void` | `initialUsername?: string; useLoginHook?: typeof useLogin` |
| `Users` / `UsersProps` | `port: UsersPort; translate: Translate; queryScope: string` | `useUsersHook?: typeof useUsers; openOwnPasswordReset?: boolean; onOwnPasswordResetClosed?: () => void` |
| `Members` / `MembersProps` | `port: MembersPort; translate: Translate` | `refresh?: IdentityRefreshPort; useMembersHook?: typeof useMembers` |
| `UserManagePanel` / `UserManagePanelProps` | `principalId: string; manage: UserManageController; t: (key: string) => string` | None |

All are one-props-object React functions returning JSX. UserManagePanel renders table rows/fragments and must be mounted in a compatible table body. Optional hook replacements are injection slots for a full matching controller; there is no general `children`, render-prop slot, or theme prop.

## Exported presentation controllers and types

Async handlers below return `Promise<void>`, synchronous setters/selectors return `void`. `t` is a string translator and `translate` is `Translate`; consumers normally obtain full screen controllers from hooks and adapt fields to the section controllers.

| Type | Fields |
|---|---|
| `GrantOption` | `id: string; name: string; isBuiltin: boolean` |
| `GrantSelectController` | `options: GrantOption[]; pendingId: string; setPendingId: Dispatch<SetStateAction<string>>; submit({ principalId: string })` |
| `UserManageController` | `error: string \| null; saving: boolean; email: { value: string; set: Dispatch<SetStateAction<string>>; saving: boolean; save({ principalId: string }) }; roleGrant: GrantSelectController; policyGrant: GrantSelectController` |
| `UserRowActionsController` | `expandedId/savingId: string \| null; toggleExpanded(user): void; requestDisable(user): void; toggleStatus(user): Promise<void>; openResetPassword(user): void; canDelete: boolean; requestDelete(user): void`, where `user` is `AdminIdentityUser` |
| `UserRowProps` | `user: AdminIdentityUser; roleById: ReadonlyMap<string, AdminRole>; policyById: ReadonlyMap<string, AdminPolicy>; actions: UserRowActionsController; manage: UserManageController; agentBase: string; t; translate` |
| `UsersTableProps` | `users: AdminIdentityUser[]; roles: AdminRole[]; policies: AdminPolicy[]; actions: UserRowActionsController; manage: UserManageController; t; translate` |

UserRow and UsersTable are internal components even though their props types are exported. Full hook dependency/option/controller types, administration DTOs/ports, and hook signatures are covered in [api.spec.md](api.spec.md).

## Observable interaction rules

- Login renders caller branding and translated sign-in text. Username defaults to blank unless `initialUsername` is supplied. Submit passes the current username/password unchanged to `LoginPort`, disables the submit button while busy, and calls `onLogin` with the returned user. Initial username changes do not overwrite a mounted draft.
- Users displays loading/error/empty/roster states, creates credentials, edits email, assigns roles/attaches policies, enables/disables accounts, resets passwords, and requests host user deletion. Grant labels resolve IDs to supplied names and fall back to IDs if missing. List order follows port output.
- Users requires confirmation before disable or delete. Delete visibility uses the `canManageUserTrash` value from `me`; it defaults false until a successful identity response. This is presentation gating; the consumer must authorize mutations independently.
- User creation/reset password fields use `autocomplete="new-password"`. Reset has separate confirmation text and visibility toggles. Mismatch blocks the dialog's confirm callback; the headless `useUsers.confirmResetPassword` checks only target/password presence. Confirmation and reveal flags clear on target change/close. Create/reset failures retain relevant drafts; successful reset closes and clears the new password.
- Automatic self-reset waits for roster and own principal ID, opens at most once per mount, and invokes the supplied close callback only after the automatically opened dialog closes. A successful self-reset displays a sign-in-again notice; the package performs no navigation/logout itself.
- The admin roles page uses lazy Roles/Policies tabs and reports `onTabChange({ tab })` without changing browser location. It accepts an optional `requestedTab`; unknown or omitted tab IDs fall back to the first visible tab. Host users navigation and translation remain deferred as documented in PORT.md.
- Role/policy create failures retain drafts; successful creates clear them. Rename/update failures retain edit state. Built-in role actions and built-in/frozen policy actions are hidden. Custom deletion and permission removal require confirmation. Removal shows its consequence and refreshes the current panel on success.
- Policy permission inputs are free text for permission and optional resource type. There is no constraint editor, catalog dropdown, role-policy linking, unassign-role, or detach-policy control.
- Members lists port data, expands/caches details, resends sign-in links, and confirms disabling. Per-row disabling/resending flags suppress repeated starts for that same action. Disabled rows omit Disable. A successful resend displays a notice; delivery is entirely owned by the port.
- Standalone user/member confirmation targets close after the attempted action, including a reported failure. Admin roles/permission confirmation remains open after a failed destructive write. Password-reset confirmation stays open on failure. Mutation errors remain in their controller's relevant error surface.

Async settlement guards and cache lifetime are specified in [state.spec.md](state.spec.md); the UI does not cancel a submitted server mutation when its panel closes.

## Styling and translation

No package-specific CSS custom properties, stylesheet export, or theme object is defined. The host supplies styles for the source's semantic class hooks, including `login-screen`, `login-card`, `login-error`, `notice`, `error`, `card`, `empty-state`, `integrations-form`, `form-measure`, `editor-actions`, `save-error`, `muted-cell`, `status`, `status-active`, `status-disabled`, `status-pending`, `member-detail`, and `visually-hidden`. Shared DataTable, RowMenu, ConfirmDialog, InfoTip, and TabBar visuals come from peer packages and their theme contracts.

Consumer translation applies to controls, headings, mapped transport errors, and confirmation copy. User-provided names/emails/IDs are data. Native Error messages can display verbatim. Some source strings are translated as fragments/dynamic keys; this package supplies neither a locale dictionary nor a guarantee that every sentence can be reordered through a single translation key.

## Accessibility and automation

The UI uses native forms/buttons/selects, label-wrapped credential/create fields, headings, tables, and member detail description lists. Login focuses username and sets `autocomplete="username"` / `"current-password"`. User/member expansion buttons expose `aria-expanded`. Password visibility buttons have translated `aria-label` and `aria-pressed`; decorative icons use `aria-hidden`. Password mismatch/error paragraphs and member row errors use `role="alert"`. Permission-removal buttons have a translated action label including the permission.

Row-menu trigger labels identify the relevant user/role/policy/member. Dialog/menu/tab keyboard behavior and focus handling are provided by shared peers; this package does not independently implement a focus trap. Loading and most other error notices are plain text, without a universal live-region guarantee. Generated `data-agent-*` handles support automation but are not substitutes for accessible names. Mounting duplicate screens in one document can repeat fixed password-field IDs/automation handles; the host owns that composition.

## Evidence and exclusions

Source: exported React components, hooks, models, ports, errors, and rules. Existing screen tests inspect branding, exact port payloads, autofill hints, translation, host navigation, and scoped queries; ported tests inspect confirmations and stale settlements. These tests were read only. No accessibility conformance level or full keyboard audit is claimed. The UI supplies no route shell, transport implementation, session storage, member-server service, mail delivery, persistence, or independent permission enforcement.
