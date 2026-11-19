---
"@jini-ai/agent-runtime": minor
---

Add `@jini-ai/agent-runtime/providers/credentials`: bring-your-own-key credential resolution (`createRequestSuppliedExecutionCredentialPort`, `createStoredExecutionCredentialPort` with an injected `readStored`), request-supplied first, then the host's stored row.
