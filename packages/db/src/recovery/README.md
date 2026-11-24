# recovery

Restore-point, migrate-forward and boot-reconciliation logic for a site database, plus the pieces
of the sidecar database journal that are not tied to a driver.

## Wiring

- `drift.ts` (`@jini-ai/db/recovery/drift`): pure and I/O-free; nothing is injected. The host's
  database introspection adapter reads the two `SchemaSnapshot`s (persisted site meta, current
  migration ledger) and passes them to `getDriftStatus`; the host's database feature imports the
  `DriftStatus`/`SchemaSnapshot` types.
- `journal-kernel.ts` (`@jini-ai/db/recovery/journal-kernel`): the journal's hand-typed tables
  (`JournalDatabase`) and `gateJournalKernel`. The host opens the journal file on its own SQLite
  driver, applies the journal DDL through the kernel, and passes that kernel plus the `ready`
  promise to `gateJournalKernel`; the host's journal repos and peer-site reads type their queries
  with `JournalDatabase`.
- `journal-schema.ts` (`@jini-ai/db/recovery/journal-schema`): the journal DDL
  (`applyDatabaseJournalSchema`) and `MIGRATION_RUN_TERMINAL_STATUSES`. Nothing is injected but the
  kernel: the host's journal driver binding calls `applyDatabaseJournalSchema({ kernel })` on the
  freshly opened journal kernel and hands the resulting promise to `gateJournalKernel` as `ready`.
- `journal-repo.sql.ts` (`@jini-ai/db/recovery/journal-repo.sql`): `SqliteDatabaseLedgerRepo`,
  `SqliteMigrationRunsRepo`, `SqliteRestorePointsRepo` over the gated journal kernel. The host's
  composition root constructs them with `{ db, siteId }` per site; `SqliteRestorePointsRepo` also
  takes `protectedRestorePointIds` (the host's in-flight publish runs) and `errorRedaction` (the
  host's extra secret patterns for the prune-failure warning). Restore-point copies are pruned with
  `pruneDatabaseCopies` from `../sqlite/backup-policy.ts`.
- Hosts import each subpath directly (the `./recovery/*` export); `index.ts` is the older entry and
  does not list these four modules.
