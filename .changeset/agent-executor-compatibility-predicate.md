---
"@jini-ai/daemon": minor
"@jini-ai/server": minor
---

Stop advertising agents `AgentExecutor` cannot run.

The built-in `agents` feature scanned every runtime definition, but `AgentExecutor` rejects some of
them (`antigravity`, whose deferral is documented in that module). A consumer could therefore offer a
user an agent that failed the instant it was selected, with the mismatch visible nowhere.

- `@jini-ai/daemon` exports `isAgentExecutorSupported(def)` and `assessAgentExecutorCompatibility(def)`.
  `run()` now consumes the latter instead of re-checking the conditions itself, so the discovery-time
  answer and the run-time guards cannot drift apart. Error messages are unchanged.
- `@jini-ai/server`'s `agents` feature applies the predicate by default, and exports
  `isExecutableDetectedAgent` for hosts that want it directly.

`antigravity`'s definition remains in `@jini-ai/agent-runtime` — the predicate is advisory, and a
non-`AgentExecutor` launch path can ignore it. An id with no registered def is kept rather than
dropped, so a host supplying its own `detector` is unaffected.

Note for anyone implementing something similar: the predicate deliberately takes the full
`RuntimeAgentDef`, not a projected `DetectedAgent`. That projection omits `maxPromptArgBytes`, and the
argv-bound defs (`aider`, `deepseek`) qualify solely through it — judging the projection would have
dropped two working agents while fixing one broken one.
