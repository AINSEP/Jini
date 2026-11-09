---
"@jini-ai/daemon": patch
---

`AgentExecutor.run` accepts an optional `compactPrompt`: the same request without optional content. It is launched instead of `prompt` only when `prompt` would fail a pre-spawn budget guard (argv prompt budget or Windows command-line limit) as actually assembled; the guards still apply to it.
