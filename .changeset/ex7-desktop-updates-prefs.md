---
"@jini-ai/desktop-host": patch
---

Add `createUpdateCheckNow`, `registerUpdateCheckIpc`, `isNetworkUpdateError` and `updateErrorMessage` to `./electron/updates`: a manual "Check for updates" that joins a running check, only looks when automatic updates are off, and takes all notice copy and error formatting from the host. Add the `./electron/preferences` subpath: injected-port JSON preference reads/writes (`readPreferenceValue`, `writePreferenceValue`, `readPreferenceSettings`), whole-number and choice helpers, save-before-apply native checkbox and radio menu items with in-place refresh, and a trusted read/write preference IPC pair.
