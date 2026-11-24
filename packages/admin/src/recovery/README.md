# recovery

Port interfaces and the navigation hook behind a point-in-time Recovery panel. The wire types
(`AdminRestorePoint`, `AdminRecoveryStatus`, `AdminDisclosureResult`, `DatabaseContextEnvelope`,
`RestoreExecuteResult`, …) are owned by `@jini-ai/admin/core` (`../core/ports/recovery.ts`,
`../core/ports/database.ts`) and are not redeclared here.

- `hooks/recovery-port.hooks.ts` — `RecoveryPort`: status, restore-point list, create, deep-link resolve.
- `hooks/restore-flow-port.hooks.ts` — `RestoreFlowPort`: disclosure, plan, confirm, execute.
- `hooks/use-recovery-navigation.hooks.ts` — `useRecoveryNavigation`: URL-controlled tab state plus
  select/back handlers; never calls a create/restore API.
- `hooks/use-recovery.hooks.ts` — `useRecovery({ port, host })`: status + restore-point list through
  the shared query cache, the no-argument restore-point creation, and the deep-link re-resolution.
- `hooks/use-restore-flow.hooks.ts` — `useRestoreFlow({ point, port, host })`: the disclosure fetch and
  the plan/confirm/execute ceremony for one restore point.
- `rules.ts` — pure labels, banner tone, deep-link envelope parsing, the restore button's name.
- `recovery-i18n.tsx` — the screen's dictionary (`t`, composed over `ADMIN_COMMON_I18N`) and its
  markup-bearing sentences; the per-locale blocks live in `recovery-i18n/` (size ratchet).

## Wiring

- The host implements `RecoveryPort` and `RestoreFlowPort` against its own admin HTTP client and
  passes them into its `useRecovery` / `useRestoreFlow` hooks (the `useX(dependencies)` /
  `useWiredX()` pair).
- `useRecovery` takes a REQUIRED `host: RecoveryHost` — `useLocale` (hook), `describeError`,
  `navigate`, `useContentRefreshSubscription` (hook) and `reportError`. `useRestoreFlow` takes a
  REQUIRED `host: RestoreFlowHost` — `useLocale` and `describeError`. Pass module-level host objects:
  the hook fields are called every render. The host keeps its zero-argument `useWiredRecovery` /
  `useWiredRestoreFlow` bindings next to its port implementations.
- `discardCountLine` takes the host stylesheet's `classNames: { row, quantity, category }`;
  `restoreButtonAccessibleName` takes the viewer's `viewerTimeZone`. The screen markup itself stays
  in the host, which owns its stylesheet.
- `useRecoveryNavigation` takes `{ tabId, setSelected, port }`: `tabId`/`setSelected` from the host
  route, and a REQUIRED `port: { navigate }` (normally the admin router's `navigate`). Pass a
  module-level port object — the returned handlers are memoized on it.
