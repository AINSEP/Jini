# trash/site

Site-level Trash pieces a host binds at composition: the directory-backed removal helpers, the widget removal rule, the sweeper schedule and the directory-rollback reporter.

## Wiring

- `ports.ts`, `remove-without-blocker.ts`, `widget-removal.ts`, `adapters/{plugin,theme}.ts`: pure; the host passes its trash service and adapters through each function's args.
- `scheduler.node.ts` (runtime `node`): the host passes the sweeper and its timer settings.
- `directory-rollback-log.ts`: `createDirectoryRollbackReporter({ log })` returns the `onRollbackError` callback for `unhideIfRemoveThrows` (`../adapters/directory.node.ts`).
  - **Needs injected**: `log(message, detail)`, the host's log sink. A server host binds its console at the composition site, e.g. `log: (message, detail) => console.error(message, detail)` (a call-time closure, so a test that replaces `console.error` still sees the call).
  - **Provides**: the fixed message `[trash] Could not unhide the directory after a failed removal` plus a `describeErrorForLog` description of the error, never the raw error.
  - **Must never**: write to `console` itself.
