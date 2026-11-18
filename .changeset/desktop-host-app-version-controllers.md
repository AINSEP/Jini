---
"@jini-ai/desktop-host": minor
---

New `./app-version` entry: `createAppVersionLoader` and `createUpdateCheck`, framework-free controllers shaped for `useSyncExternalStore` that load the host-supplied app version once per start and run one update check at a time. The `_optional` parameters of `resolveDevAppVersion` and `registerAppVersionBridge` are now plain `= {}` defaults.
