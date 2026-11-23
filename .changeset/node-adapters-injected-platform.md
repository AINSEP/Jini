---
"@jini-ai/node-adapters": major
---

The agent-plugin bindings take the platform functions they wrap from the host. (`nodeProcessControl` stays until the server preset's process cutover lands with XC-6c/d; hosts that build their own runtime can already call `createProcessControlPort({ functions })`.) `createNodeAgentPluginEffects` now requires `{ withFileLock, writeJsonFileAtomicAsync, readBootIdentity }`. `@jini-ai/agent-plugins` is no longer a peer dependency.
