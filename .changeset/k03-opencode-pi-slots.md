---
"@jini-ai/daemon": minor
"@jini-ai/agent-runtime": minor
---

OpenCode's config-document merging moves from `@jini-ai/daemon` to the `@jini-ai/agent-runtime` opencode def behind three new `AgentRuntimeStrategies` slots (`envContent`, `instructionsDocument`, `httpMcpEnv`). The daemon no longer exports `mergeEnvContentMcpConfig` or `mergeEnvContentInstructions`; `computeChildEnv` takes the bound slots as optional inputs and fails before spawn when a delivery needs a slot that is not bound.
