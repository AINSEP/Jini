---
"@jini-ai/daemon": minor
"@jini-ai/node-adapters": minor
"@jini-ai/server": minor
---

`createAgentExecutor` takes `{ lifecycle, runtime, hostEnv }` as its required first argument. `runtime` is the host's `AgentExecutorRuntimePorts` (`spawn`, `processes`, `fileLock`, `writer`, `commandShell`); `hostEnv` is required instead of falling back to the ambient process env. The options `spawn`, `createCommandInvocation`, `listProcessSnapshots`, `collectProcessTreePids` and `stopProcesses` are removed, and the executor plans commands with core's pure `planCommandInvocation` from the stated `commandShell`. `probeMcpBridge({ entry, spawn, hostEnv }, options)` takes the spawn port and host env as required fields; `CreateAgentExecutorOptions.probeMcpBridge` is the bound `McpBridgeProbe`. `@jini-ai/node-adapters/process` adds `nodeSpawnPort`, `createSpawnPort` and `nodeCommandShell`. The `server` preset binds the Node implementations unless `agentExecutor.runtime` is given, and so depends on `@jini-ai/node-adapters`.
