---
"@jini-ai/core": patch
---

Add five host-neutral contracts. `./contracts/site/recovery-operation-lock` (`OperationLockHandle`, `OperationLockError`, `AcquireOperationLockResult`), `./contracts/site/cms-core` (`PublicPostKind`), `./contracts/site/http-kit-rate-limit` (`RateLimitProfile`, `ClientIpSource`) and `./contracts/site/daemon-tool-recovery` (`ToolFailureDiagnostic`) are additive copies of the declarations in `@jini-ai/db/recovery/operation-lock`, `@jini-ai/cms/core`, `@jini-ai/http-kit/rate-limit` and `@jini-ai/daemon/tool-recovery`; those packages keep their identical declarations and exports until the paired cutover. `./contracts/site/headless-assistant-permanent-deletes-policy` (`AssistantPermanentDeletesPolicy`) is the owner's chat permanent-delete policy shape.
