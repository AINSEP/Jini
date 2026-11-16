---
"@jini-ai/core": minor
"@jini-ai/cms": patch
"@jini-ai/cms-forms": patch
---

The command, event and outbox vocabulary now lives in `@jini-ai/core/contracts/events` (new `ExecuteCommandFn` type included); `@jini-ai/cms/core` no longer defines or re-exports those types, and `executeCommand` is checked against `ExecuteCommandFn`.
