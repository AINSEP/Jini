---
"@jini-ai/core": patch
---

Add two host-neutral contracts. `./contracts/site/tool-metadata-approval-policy` (`ToolApprovalClass`, `ToolApprovalPolicy<Rule>`) specializes core's `ToolApprovalMetadata` with an optional host-owned rule name. `./contracts/site/daemon-surface-exchanges` (`AssistantSurfaceDeps`) is an additive copy of the declaration in `@jini-ai/daemon/surface-exchanges`; daemon keeps its identical declaration and its exports until the paired cutover.
