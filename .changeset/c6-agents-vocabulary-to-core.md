---
'@jini-ai/core': patch
'@jini-ai/agent-runtime': patch
'@jini-ai/daemon': patch
'@jini-ai/chat': patch
'@jini-ai/server': patch
---

Agent vocabulary moved to `@jini-ai/core/contracts/agents` (types only, plus the data-only `RuntimeSelectionError`):
`RuntimeAgentDef` and its closure, the model-catalog and discovery types, the provider model-listing shapes,
`NativeCapabilities` / `NativeToolPolicyInput` / `RunPlan`, `AgentLaunchResolution`, `PreparedPromptFile`,
`PreparedAgentLogFile`, `PromptAugmenter` and `AgentServiceFailureCode`. `@jini-ai/agent-runtime` no longer exports
these names; import them from core. Values (registry, launch, planning, discovery, sessions) stay in the runtime.

Changes a caller can see:
- `RuntimeEnv` is `Record<string, string | undefined>` (assignable both ways with Node's `ProcessEnv`).
- `RuntimeBuildOptions` has no `codexDisablePlugins`. The Codex policy is Codex definition config:
  `createNativeAgentRuntime({ env }, { codex: { disablePlugins } })`, `bindRuntimeAgentDef({ def, state }, { codex })`,
  `runtime.codex`. The Pi shutdown grace is `createNativeAgentRuntime({ env }, { pi: { gracefulShutdownMs } })`,
  `runtime.pi`. `NativeAgentRuntime.codexDisablePlugins` / `.piGracefulShutdownMs` are gone. Env defaults are unchanged
  (`CODEX_DISABLE_PLUGINS=1`, `PI_GRACEFUL_SHUTDOWN_MS`, else 5000 ms) and so is the Codex argv.
- `ProviderModelsQuery` (core) is the provider model-listing call; `ProviderModelsInput` (agent-runtime) extends it
  with the undici-only `requestInit`.
- The `AgentDiagnostic*` / `AgentFixIntent` re-export from `@jini-ai/agent-runtime` is deleted; they live in
  `@jini-ai/protocol`.
