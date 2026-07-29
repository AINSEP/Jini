---
"@jini-ai/daemon": minor
---

Add `createRunScopedContextStore` and widen `ResolvedRunInput` with the executor's optional inputs.

**`createRunScopedContextStore<T>({ lifecycle })`** — bind/resolve/auto-evict keyed by run id, for
host-owned context that must survive the gap between starting a run and a later delegated call that
carries only that run's id. `resolve` fails closed (`RunContextNotBoundError`) rather than fabricating a
default, and bindings are evicted when the run reaches a terminal state.

`resolveRunInput` could already decode and stash such context, but it is handed no lifecycle and so
cannot register the eviction half — leaving a map that only grows and keeps stale authority resolvable.
Owning both halves together is the point. `T` is fully generic: this helper does not decode
`contextRef`, does not sign or verify anything, and has no notion of a principal. It is in-memory only,
and says so — after a restart every `resolve` fails, which is the correct posture rather than a gap.

**`ResolvedRunInput` now carries `permissionMode`, `model`, `reasoning`, and `credentialEnv`**, each
forwarded to `AgentExecutor.run()` only when present.

`permissionMode` is the load-bearing one and closes a real trap: every def with an auto-approve flag
(`bypassPermissions` / `--yolo` / `--dangerously-skip-permissions`) applies it by default when the field
is absent. A host that had been passing `'restricted'` to `AgentExecutor.run()` by hand and then adopted
`createDefaultRunStartHandler` would silently have started auto-approving every action — a security
regression wearing the clothes of a refactor. Existing behavior is unchanged: omitted fields are omitted
from the executor call, never passed as an explicit `undefined`.
