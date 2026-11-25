---
"@jini-ai/core": minor
"@jini-ai/db": minor
---

`@jini-ai/db/sqlite` adds stopped-site SQLite compaction (ST-7a): `convertToIncrementalVacuum` (exclusive admission, running-lease checks at entry, after admission and before the rewrite, per-filesystem budget for the new copy, rollback journal and SQLite temp space, write-ahead `copying` marker, verified recovery copy, `converted` only after integrity ok and `auto_vacuum` reads 2), the bounded daily `incrementalVacuumStep` (refuses inside a transaction, restores the handle's busy timeout), `compactionRecoveryCopyPath` and `COMPACTION_MESSAGES`. No filesystem default ships: the host injects the port. `@jini-ai/core/contracts/storage` adds the compaction types (`SqliteCompactionMarker` including `copying`, `SqliteCompactionMarkerStore`, `SqliteCompactionFs` with `tempDirectory()`, `SqliteFileSizes`, `SqliteCompactionHoldReason`, `SqliteConversionOutcome`, `SqliteVacuumStepOutcome`).
