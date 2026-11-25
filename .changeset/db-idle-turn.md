---
"@jini-ai/db": minor
---

Add `withIdleTurn`, `IdleTurnResult` and `IdleTurnRefusal` to `@jini-ai/db/kernel`, and `TurnLock.tryAcquire`. `withIdleTurn` runs a body in an exclusive, non-queuing turn on a one-connection kernel only while the kernel is idle; kernel work that holds or waits for the lock answers `busy`, a transaction the kernel does not own answers `transaction-open`. `incrementalVacuumStep` now re-checks for an open transaction immediately before the pragma and skips as `busy`.
