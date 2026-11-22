---
"@jini-ai/core": patch
"@jini-ai/daemon": patch
---

Move host-neutral approval and surface contracts code from the host: add `./contracts/site/tool-metadata-approval-policy` (`ToolApprovalClass`, `ToolApprovalPolicy<Rule>` specializing core's `ToolApprovalMetadata`) and `./contracts/site/daemon-surface-exchanges` (`AssistantSurfaceDeps`). Additive only: `@jini-ai/daemon/surface-exchanges` keeps its identical `AssistantSurfaceDeps` until the paired cutover.
