---
"@jini-ai/daemon": minor
"@jini-ai/server": minor
---

`createTerminalSessionManager` takes the host-built `terminalService` as its required first argument and no longer builds a service, takes `loadSpawnPty`, or forwards tuning options (`maxEvents`, `maxBufferBytes`, `exitTailBytes`, `flushIntervalMs`, `flushThresholdBytes`, `ttlMs`, `shutdownGraceMs`); `CreateTerminalSessionManagerOptions` is replaced by `CreateTerminalSessionManagerRequired`. The `server` preset builds the service from `featureOptions.terminal`, which now also carries those tuning options. Node-pty stays opt-in: without a `loadSpawnPty`, `create()` rejects with the same guidance, whose wording now names `@jini-ai/server/adapters/node-pty` instead of the removed `@jini-ai/daemon/terminal`.
