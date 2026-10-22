---
"@jini-ai/agent-runtime": minor
---

Add the optional `onUnexposedToolCall` refusal hook to `runProviderToolTurn` for all four
provider protocols. Hosts can await audit writes and supply uniform refusal text without
calling the normal tool executor. Results remain errors; omitted hooks and `undefined`
replies preserve the existing refusal text and protocol formatting. Hook failures propagate
without falling through to execution.
