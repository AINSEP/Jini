---
"@jini-ai/desktop-host": patch
---

Add `@jini-ai/desktop-host/electron/windows`: `appWindowOptions` / `createAppWindow` (a sandboxed standalone app window with an injected title, URL, partition, preload path, `BrowserWindow` factory and navigation-policy installer; tracks, pins the title and installs the boundary before the first load) and `applyDockIcon` (best-effort macOS dock icon with an injected `reportFailure` reporter).
