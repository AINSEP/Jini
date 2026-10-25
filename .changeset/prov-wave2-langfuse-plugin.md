---
"@jini-ai/agent-runtime": patch
"@jini-ai/provider-plugins": patch
---

The Langfuse AI-trace sink moved out of `@jini-ai/agent-runtime` into the `ai-trace-langfuse` provider plugin (contract `ai_trace`), which bundles the `langfuse` SDK. Removed: the `@jini-ai/agent-runtime/ai-trace/langfuse` subpath (`createLangfuseAiTraceSink`, `loadLangfuseAiTraceSink`, `toLangfuseCall`). The runtime core has no Langfuse reference; a core-wide boundary test refuses vendor SDK imports or dependencies in any other package.
