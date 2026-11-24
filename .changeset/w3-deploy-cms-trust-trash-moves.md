---
"@jini-ai/cms": patch
---

Add `publish/trust/{grant,provisioning,provisioning-status,provisioning.node-io,revocations}`, and `trash/site/directory-rollback-log` (`createDirectoryRollbackReporter`, injected log sink). The publish-trust override env var name is host-owned and passed to the status sentences as `settingName`.
