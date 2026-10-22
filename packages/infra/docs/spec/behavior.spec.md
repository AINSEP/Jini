Spec ID: SPEC-JINI-INFRA-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:c45cd81b26988ad49d1d55563d0a92f3a01ce821c01c018a7735ca0538a280dc
spec_mode: reverse_spec

# Behavior Contract: @jini-ai/infra

## Shim guarantees

The two ESM entries re-export selected symbols from `@jini-ai/db` without wrappers, transformations, or added state. They preserve eight core declarations and seven SQLite declarations, including erased types. There is no root import, CommonJS branch, bundled driver, or outbox export.

`sanitizeForFilename` replaces every character outside ASCII letters, digits, underscore, and hyphen with underscore. `restorePointFilename` produces `restore-point-<sanitized scope>-wm<watermark>-<timestamp>.<extension>`, default extension `db`. Only the scope string is sanitized; consumers supply safe watermark/timestamp/extension values.

## Connection and restore behavior

- `openSqliteConnection` runs the optional synchronous recovery hook before opening. It passes the path and an empty options object to the host opener. It applies the supplied pragmas, or WAL, foreign keys ON, and 5000 ms busy timeout, in that order. An explicit empty pragma list applies none.
- The adapter always advertises cheap file-snapshot restore points. Capture reads the watermark before requesting backup, creates its name with the consumer clock or `Date.now`, and stores the artifact beside the database file; `:memory:` uses the OS temporary directory.
- Capture returns only after backup resolves. The package does not create a transaction around the watermark read and backup, so coherence between watermark and snapshot is a host guarantee.
- For a file database, restore checks the artifact is accessible, copies it to a random temporary sibling, renames the sibling over the database, and best-effort removes WAL/SHM sidecars. It returns `restartRequired: true`.
- For `:memory:`, restore performs no artifact validation or data replacement and returns `restartRequired: false`.
- Restore does not close or reopen the live connection, restart the process, validate database integrity, constrain artifact paths, enforce permissions, deduplicate captures, expire snapshots, or implement retention.

The host must quiesce database users and coordinate restart/reopen around a file restore. This contract describes existing operations, not a concurrent live-recovery guarantee.

## Evidence and known issues

`src/db/core/index.ts` and `src/db/sqlite/index.ts` contain only re-exports. `src/__tests__/shim-surface.test.ts` freezes their declarations/runtime names and manifest shape. Delegated behavior comes from `@jini-ai/db/src/sqlite/open.ts` and `db-ops.ts`; the db package's SQLite tests exercise those operations. No contradiction between the two shim barrels and their surface assertions was found by reading. No tests or builds were run.

Related source rationale: [worker-owned bounded outbox retries](../decisions/DR-001-bounded-outbox-retries.md); this does not expand the database shim guarantees above.
