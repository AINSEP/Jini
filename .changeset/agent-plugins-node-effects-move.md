---
"@jini-ai/agent-plugins": minor
"@jini-ai/node-adapters": minor
---

`createNodeAgentPluginEffects` moves from `@jini-ai/agent-plugins/lifecycle/node` to `@jini-ai/node-adapters/agent-plugins` (same name, signature and body; it now also returns `fileLock` and `atomicWriter`). The `./lifecycle/node` entry is removed from agent-plugins, and `@jini-ai/platform` is no longer a peer of agent-plugins. Hosts change one import and declare `@jini-ai/node-adapters` (agent-plugins is its optional peer, for the port types).
