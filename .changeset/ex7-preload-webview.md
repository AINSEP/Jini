---
"@jini-ai/desktop-host": patch
---

Add `./electron/preload` (`createPreloadSubscriber`: subscribes a renderer listener to one main-to-renderer IPC channel through an injected args-object `ipcRenderer` port, drops the raw IPC event, and returns a cleanup that removes exactly that listener) and `./electron/webview` (DOM-free structural types for Electron's `<webview>` event details and element methods). The channel allowlist, renderer globals and JSX registration stay with the host.
