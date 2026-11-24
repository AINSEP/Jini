---
"@jini-ai/ui": major
"@jini-ai/core": minor
---

The execution-card types moved to `@jini-ai/core/contracts/execution` as one unit: `ExecutionPort`, `ExecutionConfig`, `ByokConfig`, `LocalCliConfig`, `ProviderPreset`, `ApiProtocol`, the agent-diagnostic and test/scan/discovery state types, and the rest of the former `features/execution/types.ts`. `@jini-ai/ui` and `@jini-ai/ui/core` no longer export them — import them from the core subpath. The detected-CLI shape is renamed `DetectedAgent` → `ExecutionCardAgent` so core never carries two `DetectedAgent` types. Runtime values (rules, constants, the fake port, the HTTP adapter, hooks, components) stay in `@jini-ai/ui`.
