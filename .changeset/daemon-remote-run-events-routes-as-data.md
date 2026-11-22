---
"@jini-ai/daemon": minor
"@jini-ai/server": patch
---

The remote run-event routes are returned as data: `registerRemoteRunEventRoutes` is replaced by `remoteRunEventRoutes({ deps, host })`, and the Express gate `requireRemoteToolBridgeToken` by the web-standard `remoteToolBridgeTokenGate`. Each route carries its bridge-token gate, so a host cannot mount one without it. `RemoteRunEventHttpDeps.env` is now required (the daemon no longer reads `process.env`), the constant-time compare comes from the host, and a request with another method on those two paths is no longer answered by the gate (it falls through to the host's next layer).
