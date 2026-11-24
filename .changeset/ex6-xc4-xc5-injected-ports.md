---
"@jini-ai/daemon": minor
"@jini-ai/integrations": minor
"@jini-ai/server": patch
---

Inject collaborators instead of importing another package's implementation (owner rule K5, XC-4/XC-5).
`modelProxyRoutes` now requires `deps.toolTurns` (`ProviderToolTurnPort`), `researchRoutes` /
`createTavilyResearchProvider` require `baseUrlGuard` (`BaseUrlGuardPort`), and `executeSavedRequest`
requires `deps.createHttpClient`. The `@jini-ai/server` preset binds the real agent-runtime functions.
