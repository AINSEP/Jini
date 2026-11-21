---
"@jini-ai/sidecar": minor
---

`createNodeDaemonProcessAdapter` takes the host's process control and command shell as required `process: ProcessControlPort` and `commandShell: { platform, fallbackComSpec }` instead of importing `@jini-ai/platform/command` and `@jini-ai/platform/process`; it plans the launch with core's pure `planCommandInvocation`. The options `listProcessSnapshots`, `waitForProcessExit` and `stopProcesses` are removed. Node hosts pass `nodeProcessControl` and `nodeCommandShell({ env: process.env })` from `@jini-ai/node-adapters/process` (the same platform and `ComSpec` fallback the platform builder read). `@jini-ai/platform` is no longer a dependency of sidecar.
