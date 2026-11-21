---
"@jini-ai/agent-plugins": minor
---

The plugin lifecycle takes its file lock and its atomic journal writer as required ports (`fileLock`, `atomicWriter` on `AgentPluginLifecyclePorts`) instead of importing them from `@jini-ai/platform`. Hosts that spread `createNodeAgentPluginEffects({})` get both already; a host that builds its own effects must now supply them.
