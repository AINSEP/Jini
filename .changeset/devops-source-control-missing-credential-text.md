---
"@jini-ai/devops": minor
---

`CommitOrchestrationArgs` gains an optional `describeMissingCredential({ providerId })`: the host supplies the whole refusal sentence when no credential is configured (for example where to connect one). Absent, the generic sentence naming the provider is used as before.
