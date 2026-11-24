---
"@jini-ai/core": minor
"@jini-ai/daemon": minor
"@jini-ai/agent-runtime": minor
"@jini-ai/agentic": minor
"@jini-ai/chat": minor
"@jini-ai/cms": minor
"@jini-ai/db": minor
"@jini-ai/infra": minor
"@jini-ai/platform": minor
"@jini-ai/sidecar": minor
---

w5-runtime-assistant (rv1123r fixes + reviewer DISAGREE moves). Breaking for direct callers (pre-1.0 minor):
- infra `outboxWorkerArgs`/`processDomainOutbox` require `scheduler` and `logger` (host constructs them).
- sidecar parent watchdog reports structured `ParentWatchdogEvent`s through one `report` port; the host formats lines.
- db restore-points repo requires `onPruneWarning`; no console output from the engine.
- cms media access evidence is an instance (`createMediaAccessEvidence()`); the module-level helpers are removed.
- core `ToolResultContentBlock` replaces agent-runtime `ProviderToolResultBlock` and daemon `ByokToolResultBlock`.
- daemon A2UI actions route is a `defineJsonRoute` spec (`a2uiActionsRoutes`); the MCP-UI callback has a server-neutral `answerSurfaceCallback`; A2UI parser/catalog collaborators are injected (agentic `renderA2uiSurface` too).
- New: core `contracts/site/{client-directives,daemon-core-rpc}`, daemon `core-rpc-schema`, chat `createRunCheckpointer`, sidecar `./daemon-connection`, platform `fs` `resolveDirectoryTarget`/`moveDirectoryUnderLeases` and `./image/png-encode`, db `pglite` `copyPgliteSourceTo`, agentic `createRenderUiToolRegistrations`.
