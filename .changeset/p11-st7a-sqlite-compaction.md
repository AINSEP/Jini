---
"@jini-ai/db": patch
"@jini-ai/core": patch
---

`@jini-ai/db/sqlite` adds `convertToIncrementalVacuum` and `incrementalVacuumStep` (P11 ST-7a). Conversion runs on a stopped file only: the host's running-lease probe, then SQLite's exclusive lock as admission (any other connection defers as busy before a byte changes), a per-filesystem disk budget, a checked and durably published `pre-compact-<db>-<ms>.db` recovery copy, the rewrite and its check, and a completion marker bound to the file's identity; a failed check is recorded as `needs-attention` and never retried automatically. The daily step runs a bounded `incremental_vacuum` on the host's handle only for a file converted under its current identity, defers on busy and restores the handle's busy timeout. `@jini-ai/core/contracts/storage` adds the marker-store, filesystem-port and outcome types.
