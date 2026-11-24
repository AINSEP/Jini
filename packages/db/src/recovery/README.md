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
- Hosts import each subpath directly (the `./recovery/*` export); `index.ts` is the older entry and
  does not list these two modules.
