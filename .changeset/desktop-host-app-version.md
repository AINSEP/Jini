---
"@jini-ai/desktop-host": minor
---

`@jini-ai/desktop-host/electron` exports `registerAppVersionBridge` and `resolveDevAppVersion`: a read-only app-version IPC handler (packaged builds answer `app.getVersion()`, dev launches the nearest release tag plus a dev suffix); the host injects the tag convention, suffix, channel id and git port.
