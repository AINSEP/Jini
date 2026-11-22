---
"@jini-ai/node-adapters": major
---

The process and agent-plugin bindings take the platform functions they wrap from the host. `nodeProcessControl` is removed: call `createProcessControlPort({ functions: { listProcessSnapshots, stopProcesses, waitForProcessExit } })`. `createNodeAgentPluginEffects` now requires `{ withFileLock, writeJsonFileAtomicAsync, readBootIdentity }`. `@jini-ai/agent-plugins` is no longer a peer dependency.
