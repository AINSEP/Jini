# app-version

React bindings for a desktop app's version label and its "Check for updates…" menu row.

Entry: `@jini-ai/ui/app-version` — `useAppVersion` and `useUpdateCheck` (standalone hooks the host
calls), plus the structural ports `AppVersionLoaderPort` and `UpdateCheckPort`.

## Wiring

The host injects:

- `bridge` — its preload bridge (or `undefined`); channel names stay host-owned.
- `createLoader` / `createCheck` — the framework-free factories (the desktop host toolkit's
  `createAppVersionLoader` / `createUpdateCheck`). Injected, not imported, so `@jini-ai/ui` keeps no
  dependency on the desktop host package. Pass module-level functions so their identity is stable.
- `onDone`, `report` — the menu's close callback and the host's own log line for a broken channel.

The host's renderer adapters (its `useAppVersion` / `useUpdateCheck` wrappers) supply the bridge
lookup, factories and log prefix; its top navigation and settings menu call those adapters.
