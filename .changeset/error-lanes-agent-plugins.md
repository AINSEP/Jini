---
"@jini-ai/agent-plugins": minor
---

`ProvisionAgentPluginMcpServersResult.failed[]` entries gain an optional `error` (the caught value, for host logs only); `reason` stays the caller-facing text. Plugin boot, seed and retire warnings name the error class instead of quoting its message. **Host action:** none required; read `failed[].error` if you log provisioning failures yourself.
