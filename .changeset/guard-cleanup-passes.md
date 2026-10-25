---
"@jini-ai/admin": patch
"@jini-ai/agent-plugins": patch
"@jini-ai/agent-runtime": patch
"@jini-ai/chat": patch
"@jini-ai/cms": patch
"@jini-ai/commerce": patch
"@jini-ai/core": patch
"@jini-ai/daemon": patch
"@jini-ai/diagnostics": patch
"@jini-ai/mcp": patch
"@jini-ai/memory": patch
"@jini-ai/platform": patch
"@jini-ai/search": patch
"@jini-ai/ui": patch
---

Engine guard clean-up (`pnpm guard` 106 -> 0): layer, subpath-isolation and module-state findings fixed by moving
shared contracts to their owners instead of reaching across domains. Additive public API: `@jini-ai/core/filesystem`
(guarded-reader contracts), `useFetchQueryScope` from `@jini-ai/ui` fetch-query (per-provider query scope),
`@jini-ai/chat/react` re-exports of the accepted-input, run-state and agent-plugin chat-state helpers. The Claude
filesystem probe cache in `@jini-ai/agent-runtime` is instance-owned. No behaviour change intended; host-facing
breaks are listed in `owner-store-to-server` and `guard-host-ports`.
