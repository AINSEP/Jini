---
'@jini-ai/daemon': patch
'@jini-ai/agent-runtime': patch
'@jini-ai/chat': patch
---

New, additive: `@jini-ai/daemon/ports/agent-runtime` states everything the daemon needs from an agent runtime as one
`AgentRuntimePort` (`defs`, `launch`, `filesystem`, `models`, `sessions`, `streams`, `failures`) plus `BaseUrlGuardPort`.
`createAgentRuntimeBindings({ runtime })` in `@jini-ai/agent-runtime` binds a native runtime to that shape; a host checks
it with `satisfies AgentRuntimePort`. `@jini-ai/chat/core` exports `ChatAgentPolicyPort` and `ChatAgentFailurePort`.
Nothing consumes the ports yet: the launcher and the chat engine take them in later changes.

The port's stream sink is typed `(event: Record<string, unknown>) => void`, looser than each parser's own event union;
this matches what the launcher already passes today.
