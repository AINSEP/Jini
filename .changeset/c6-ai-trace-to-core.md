---
'@jini-ai/core': patch
'@jini-ai/agent-runtime': patch
'@jini-ai/daemon': patch
'@jini-ai/analytics': patch
'@jini-ai/provider-plugins': patch
'@jini-ai/server': patch
---

AI-run tracing (contract, recorder, sinks, capture, usage) moved from `@jini-ai/agent-runtime/ai-trace` to
`@jini-ai/core/contracts/ai-trace`. It is pure and three packages consume it, so it is shared vocabulary rather
than part of one agent runtime. The `./ai-trace` subpath and the root re-export are gone from
`@jini-ai/agent-runtime`; import the same names from `@jini-ai/core/contracts/ai-trace`. No behaviour change.
