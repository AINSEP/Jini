---
"@jini-ai/core": patch
"@jini-ai/devops": patch
---

Move `canonicalJson` to `@jini-ai/core/records` so packages below devops can reuse it (the infra outbox request digest). `@jini-ai/devops/dns` re-exports it unchanged.
