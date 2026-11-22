---
"@jini-ai/daemon": minor
"@jini-ai/server": minor
---

The node-pty adapter moves from daemon to the server preset. `@jini-ai/daemon/terminal` is removed (breaking, pre-1.0 minor) and daemon no longer lists `node-pty` as a peer; import `loadRealSpawnPty` from `@jini-ai/server/adapters/node-pty` instead, which now declares the optional `node-pty` peer.
