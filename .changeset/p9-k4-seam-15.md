---
"@jini-ai/core": patch
---

Add four type-only contracts. `./contracts/site/core-consent-refusal` (`ConsentProblem`) is the consent refusal shape a publish returns. `./contracts/site/search` (`SearchProvider`, `SearchServiceResult` and their structural closure), `./contracts/site/agent-plugins-connect` (`CredentialSaveAdapters`, `LoadPluginCredentialCards`) and `./contracts/site/daemon-http` (`PendingAttachmentSummary`, `FrontendHookInput`, `StoredAttachment`) are additive copies of the declarations in `@jini-ai/search`, `@jini-ai/agent-plugins/connect` and `@jini-ai/daemon/http`; those packages keep their identical declarations and exports until the paired cutover.
