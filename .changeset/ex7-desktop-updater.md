---
"@jini-ai/desktop-host": patch
---

`@jini-ai/desktop-host/electron/updates` adds the desktop updater lifecycle `createDesktopUpdater` (with `createDesktopUpdaterState` and the `DesktopUpdaterPorts`/`DesktopUpdaterReporter` ports: injected eligibility, preference read/save, lazy native updater, controller factory and reporter; one start in flight shared with a manual check; quit held exactly when the controller installs a downloaded update) and the native update boxes `showOnFocusedWindow`, `showNativeNotice`, `promptUpdateReady`, `explainOthersOpen`, `updateReadyPromptOptions` and `othersOpenOptions`, which take all wording from the host.
