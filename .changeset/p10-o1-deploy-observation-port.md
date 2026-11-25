---
"@jini-ai/devops": minor
---

Add an optional `observeDeploy` hook to `DeployOpsRuntime` in `@jini-ai/devops/deploy`. `runDeploy` now wraps its whole body, including pre-abort and observe-only refusals, in the hook with the raw requested platform text, so the registered deploy tool can be observed at its real execution owner. Without a hook, behavior is unchanged.
