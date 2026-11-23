# recovery

Port interfaces and the navigation hook behind a point-in-time Recovery panel. The wire types
(`AdminRestorePoint`, `AdminRecoveryStatus`, `AdminDisclosureResult`, `DatabaseContextEnvelope`,
`RestoreExecuteResult`, …) are owned by `@jini-ai/admin/core` (`../core/ports/recovery.ts`,
`../core/ports/database.ts`) and are not redeclared here.

- `hooks/recovery-port.hooks.ts` — `RecoveryPort`: status, restore-point list, create, deep-link resolve.
- `hooks/restore-flow-port.hooks.ts` — `RestoreFlowPort`: disclosure, plan, confirm, execute.
- `hooks/use-recovery-navigation.hooks.ts` — `useRecoveryNavigation`: URL-controlled tab state plus
  select/back handlers; never calls a create/restore API.

## Wiring

- The host implements `RecoveryPort` and `RestoreFlowPort` against its own admin HTTP client and
  passes them into its `useRecovery` / `useRestoreFlow` hooks (the `useX(dependencies)` /
  `useWiredX()` pair).
- `useRecoveryNavigation` takes `{ tabId, setSelected, port }`: `tabId`/`setSelected` from the host
  route, and a REQUIRED `port: { navigate }` (normally the admin router's `navigate`). Pass a
  module-level port object — the returned handlers are memoized on it.
