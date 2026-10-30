---
"@jini-ai/platform": minor
---

Add `createDeadlineSignal` and `DeadlineSignalOptions` to `@jini-ai/platform/fetch-with-timeout`
and the root entry. Compose a tool's remaining wait budget with optional caller cancellation,
subtract elapsed time through an optional start time and clock port, and clamp remaining time to zero.
