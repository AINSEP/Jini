---
"@jini-ai/daemon": minor
"@jini-ai/core": minor
"@jini-ai/agent-runtime": patch
---

Fit host prompt variants at the real argv boundary and add the plugin preflight route spec.

- `@jini-ai/core`: `RuntimeAgentDef.argvPromptPosition?: 'last'` declares that `buildArgs` emits the composed prompt verbatim as its last argument.
- `@jini-ai/agent-runtime`: the aider, antigravity, and deepseek defs declare `argvPromptPosition: 'last'`. No argv bytes change.
- `@jini-ai/daemon`: `AgentExecutor.run` accepts optional `argvPromptVariants` (`full`, `catalog`, `pointer`, `base`). After the single `buildArgs` call, the executor verifies the last argument equals the composed base prompt, then substitutes the richest candidate that passes the prompt, Windows `.cmd` shim, and direct `.exe` budgets for the resolved binary, using the same image-path and overlay transformations as the base. `onSelected` runs after validation and before spawn; a rejection releases staged resources and the run never spawns. Runs without variants, and defs that do not declare the position, are byte-identical.
- `@jini-ai/daemon/http`: `agentPluginPreflightRoute` (`POST /internal/agent-plugin-preflight`), a `defineJsonRoute` spec accepting the legacy `{ runId }`, `{ op: 'offer', runId }`, and `{ op: 'commit', runId, offerId, deliveredIds }` bodies. Unknown fields (including identity fields), malformed ids, and duplicate delivered ids are rejected with 400.
