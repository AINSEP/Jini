---
"@jini-ai/core": patch
---

Add four host-neutral type contracts. `./contracts/site/assistant-host-ports` (`ToolGapsToolDeps`, `ToolGapReadPort`) and `./contracts/site/lifecycle-boot-lifecycle` (`BootModuleResult`, `ModuleLifecycleStatus`, `BootCriticality`) are the host's tool-gaps tool dependencies and per-module boot outcome vocabulary. `./contracts/site/sandbox-node-worker` (`SandboxRenderResult`) and `./contracts/site/recovery-reconcile-interrupted-migration` (`SiteStatusPort`, `SiteServeStatus`) are additive copies of the declarations in `@jini-ai/sandbox/node-worker` and `@jini-ai/db/recovery/reconcile-interrupted-migration`; those packages keep their identical declarations and exports until the paired cutover.
