---
"@jini-ai/agent-runtime": minor
---

Agent probes plan their command with core's pure `planCommandInvocation` instead of `@jini-ai/platform`. The ambient platform and `ComSpec` are read through the new `ambientCommandShell` and can be passed as `commandShell` to `execAgentFile`. Behaviour on Windows `.cmd` shims is unchanged, including the fallback to the process's own `ComSpec`.
