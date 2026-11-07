/**
 * @file The core-mediated plugin dataModule engine (ADR-023 §2/§3/§4/§5/§6/§9).
 *
 * A plugin DECLARES its desired tables as data; CORE alone executes the DDL. A plugin never
 * authors a migration and never holds a raw DB handle. The flow, in order:
 *   1. validate the declaration (namespace `p_{pluginId}__*` §5, column shape, tier §3/T6) —
 *      before any I/O;
 *   2. skip tables that already exist (idempotent, state-based reconciliation §2);
 *   3. disk-headroom preflight (§3/T4) — fails closed before any file is touched;
 *   4. namespace-adoption guard (§5/§6/T5) — fails closed on an unresolved provenance mismatch;
 *   5. **snapshot the whole db FIRST** (§4) — the never-brick anchor;
 *   6. open a durable phase-journal entry (§2/T3);
 *   7. run all DDL, the post-DDL verification, AND the journal's own COMMITTED transition inside
 *      ONE transaction (see this file's POST-COMMIT DATA-LOSS WINDOW section for why verification
 *      and the journal write are in-transaction too, not just the DDL) so a failure rolls the live
 *      db AND the journal back together to a working, truthfully-recorded state (§9: recoverable,
 *      not zero-loss) — SQLite's own transaction rollback handles this same-process, non-crash
 *      case; the snapshot/journal exist for the CRASH case, recovered at next boot by
 *      `migration-recovery.ts` (see that file and `restore.ts` for why restore only ever runs
 *      there, never live).
 *
 * IN-MEMORY `dbPath` (BUG FIX, 2026-07-28): steps 3, 5, and 6 above are conditionally skipped for an
 * in-memory (or SQLite's other non-file) `dbPath` — see `snapshot.ts`'s `isInMemoryDbPath`. Disk
 * headroom (step 3, via `disk-headroom.ts`) and the whole snapshot/journal apparatus (steps 5-6)
 * exist specifically to make "recovery at next boot" possible; for `:memory:` there IS no next
 * boot — the database is discarded in full the instant the process ends, so "recoverable" and
 * "not recoverable" are the same outcome regardless of whether a snapshot/journal entry exists.
 * Skipping them for this case isn't a weakened guarantee, it's recognizing the guarantee doesn't
 * apply. Step 7's same-process transaction rollback is UNAFFECTED and remains the full safety net
 * for an in-memory db, because it is the only failure mode that can ever occur for one (there is no
 * separate process to crash-and-restart into that could observe a different, corrupted state).
 *
 * COLUMN-LEVEL RECONCILIATION (BUG FIX, 2026-08-12): §2's own text is "Core diffs declared-state
 * against live-state and executes the DDL itself" — but the first implementation of step 2 only
 * diffed *table names*, not table *contents*. A plugin whose v2 manifest added a column to an
 * already-existing table got `{ ok: true, created: [] }` back — the table-name presence check saw
 * the table, concluded there was nothing to do, and took the early no-op path — and the new column
 * silently never existed. The failure then surfaced far from its cause: at query time, against
 * whatever repository call first touched the missing column, with no link back to the manifest
 * that declared it. Step 2 now diffs declared columns against `PRAGMA table_info` for every table
 * that already exists, not just the table's name. A declared-but-missing column on an existing
 * table has three possible outcomes: (a) a plain nullable, non-PRIMARY-KEY column is safely
 * addable via `ALTER TABLE ADD COLUMN` and gets queued as an alteration; (b) a `NOT NULL` column
 * cannot — SQLite refuses `ADD COLUMN` with a `NOT NULL` constraint unless a non-NULL default is
 * also supplied, and this declaration grammar (`ColumnDecl`) has no default field to supply one,
 * so this fails closed with `COLUMN_ADD_NOT_NULL_WITHOUT_DEFAULT`; (c) a `PRIMARY KEY` column can
 * never be added to an existing table via `ALTER TABLE` at all — SQLite has no such statement,
 * only a full create-copy-drop-rename table rebuild, which is a materially larger and riskier
 * change than this fix and stays explicitly out of scope — so this fails closed with
 * `COLUMN_ADD_PRIMARY_KEY`. A live column whose type no longer matches its declaration also fails
 * closed (`COLUMN_TYPE_MISMATCH`) for the same reason: a type change is a rebuild, not an `ALTER`.
 *
 * CONSTRAINT-LEVEL RECONCILIATION (BUG FIX, 2026-08-12): the reconciliation above diffed an
 * existing column's `type` but not its `notNull`/`primaryKey` declarations — a plugin author
 * tightening either constraint on an already-existing column (e.g. a v2 manifest marking a
 * previously-nullable column `notNull: true`) got `{ ok: true, altered: [] }` back with the live
 * column completely unchanged: the identical silent-non-enforcement bug class the type-mismatch
 * fix above closed, just for two different fields on the same struct. `assertColumnNotNullMatches`
 * and `assertColumnPrimaryKeyMatches` now run alongside `assertColumnTypeMatches` for every
 * existing column a declaration mentions, each failing closed (`COLUMN_NOT_NULL_MISMATCH` /
 * `COLUMN_PRIMARY_KEY_MISMATCH`) on disagreement, for the same reason as the type case: SQLite's
 * `ALTER TABLE` cannot change either constraint on an existing column — no `ALTER COLUMN`, no way
 * to add or drop a `NOT NULL` or `PRIMARY KEY` short of the same create-copy-drop-rename rebuild
 * this file stays out of scope of everywhere else.
 *
 * Both checks are DIRECTION-AGNOSTIC — declared-stricter-than-live and declared-looser-than-live
 * both fail closed — deliberately mirroring `COLUMN_TYPE_MISMATCH`'s own symmetric behavior rather
 * than only catching the tightening direction the bug report above led with. The two directions
 * are not equally *dangerous* (tightening risks silent bad data creeping in past a constraint the
 * app believes SQLite is enforcing; loosening at most risks a write later hitting a live
 * constraint the current manifest doesn't mention, which SQLite itself rejects loudly at write
 * time, not silently) — but both are still a manifest that disagrees with the database it
 * describes, and this module's whole job is to surface that disagreement at `declare()` time,
 * next to the manifest, rather than let either direction surface later at some unrelated write
 * site with no link back to the manifest. `COLUMN_TYPE_MISMATCH` never special-cased "safe"
 * directions either (e.g. widening `INTEGER` to `REAL` isn't unsafe the way `TEXT`→`INTEGER` is)
 * for the same underlying reason, so this stays consistent with the established fail-closed
 * default rather than inventing a narrower rule for these two fields alone.
 *
 * `assertColumnPrimaryKeyMatches` compares against `getExistingColumns`'s already-boolean
 * `primaryKey` field (`pk !== 0`, not `pk === 1`) so a column that is part of a *composite*
 * primary key (`PRAGMA table_info`'s `pk` is an ordinal position, 1-based, not a 0/1 flag) is
 * still read correctly as "is a primary key column" rather than only the first component
 * matching. Whether that scenario can even arise given this engine's own DDL is a separate
 * question: `ColumnDecl.primaryKey` is a single-column boolean with no table-level composite-key
 * grammar, and `CREATE TABLE` with two columns each carrying a column-level `PRIMARY KEY`
 * constraint is rejected by SQLite itself ("table has more than one primary key") before this
 * code ever runs — so this engine cannot *create* a composite-PK table through its own DDL. A
 * live table could still carry one from outside this engine's DDL entirely (the §0 access-control
 * caveat below: a Tier-3 plugin holding a raw handle, or a table that predates this engine) — the
 * ordinal-aware read guards against exactly that case rather than assuming it can't happen.
 *
 * A live column the CURRENT declaration no longer mentions is deliberately left alone rather than
 * dropped — this engine never authors a `DROP COLUMN` on a plugin's behalf; an operator who rolled
 * a plugin back to an older manifest, or a manifest that stopped mentioning a column on purpose,
 * should not lose that column's data to a silent, unrequested `DROP`. When an existing table needs
 * one or more columns added, the full snapshot/journal/single-transaction apparatus below still
 * runs for it exactly as it does for a brand-new table — only the fully-reconciled no-op case
 * (every declared table exists with every declared column already present and matching) skips it.
 *
 * INDEX-LEVEL RECONCILIATION (BUG FIX, 2026-08-12): the column-level reconciliation above still
 * built `toAlter` from `columnsToAdd` alone — a declared `IndexDecl` on an already-existing table
 * was reconciled only on the CREATE path (`table.indexes` was only ever walked inside the
 * `plan.toCreate` loop), so a v2 manifest that added an index to an existing table got
 * `{ ok: true, altered: [...] }` back (truthfully reporting the column work, if any) with the
 * index itself silently never created — the identical bug class one level up. The kernel's `listIndexes`
 * reads `fqTableName`'s live indexes via `PRAGMA index_list` + `PRAGMA index_info`, filtered to
 * `origin: 'c'` rows only: SQLite also auto-creates an implicit index per `UNIQUE` column
 * constraint (`origin: 'u'`) and one for most `PRIMARY KEY` shapes (`origin: 'pk'`, e.g.
 * `sqlite_autoindex_*`), neither of which was ever declared through `IndexDecl` or created by this
 * module's own `indexSql` — diffing against those would be comparing against something the
 * declaration grammar can't even express. `planIndexReconciliation` then diffs declared indexes
 * (matched by the SAME generated name `indexSql` already uses to create one) against that live
 * set: a declared index missing live is queued in `indexesToAdd`, safely creatable via a plain
 * `CREATE INDEX` — unlike the column NOT NULL/PRIMARY KEY cases above, an index carries no data
 * for `ALTER` semantics to conflict with, so there is no "SQLite literally cannot express this"
 * case here to fail closed on. A declared index whose live shape (column list, in order, or
 * uniqueness) no longer matches is queued in `indexesToRecreate` (`DROP INDEX` then `CREATE INDEX`,
 * both inside this call's single transaction, so a mid-way failure rolls back exactly like any
 * other DDL here) — a deliberate choice, not an oversight: an index is pure derived structure with
 * no data of its own, so dropping and rebuilding it risks nothing a rollback wouldn't already
 * protect, in sharp contrast to a column whose type/constraint this file explicitly refuses to
 * touch because doing so risks the column's actual data. The one way this CAN still fail is a
 * `CREATE UNIQUE INDEX` rejected by genuine live duplicate values — that surfaces exactly like any
 * other DDL failure in this transaction (rollback, `DDL_FAILED`, snapshot kept as the recovery
 * point), needing no special-casing. A live index the CURRENT declaration no longer mentions is
 * left alone, mirroring the column-drop policy directly above. `assertIdentifierFits` already
 * covers every declared index's generated name unconditionally, for both the create and alter
 * paths — `validate()` walks `table.indexes` for every table in the declaration up front, before
 * reconciliation ever runs, so no separate length check is needed in this new path.
 *
 * POST-COMMIT JOURNAL INTEGRITY (BUG FIX, 2026-08-12): the catch block below used to write
 * `ROLLED_BACK` unconditionally on ANY failure inside the DDL try block — but a failure can occur
 * either BEFORE the `db.transaction()` call resolves (SQLite's own rollback truly undid every
 * write; `ROLLED_BACK` is accurate) or AFTER it already committed (`verifyPostDdl` throwing, or
 * even the `advancePhaseIfJournaled(..., "COMMITTED")` write itself throwing) — and for that second
 * case, the DDL is live and durable, so `ROLLED_BACK` was a lie: the journal claimed a rollback
 * that never happened. `migration-recovery.ts` only ever restores NON-terminal entries
 * (`ROLLED_BACK`/`COMMITTED` are both terminal, see `migration-journal.ts`'s `TERMINAL_PHASES`), so
 * a next-boot crash recovery would see this mislabeled entry, conclude there is nothing to do, and
 * skip it — leaving the live db and the journal's account of it permanently disagreeing, with
 * nothing left to ever reconcile them. `declareDataModule` now tracks `transactionCommitted`,
 * flipped to `true` the instant `db.transaction(() => { ... })()` returns without throwing, and
 * `recordFailurePhase` uses it to decide: pre-commit, write `ROLLED_BACK` as before (truthful,
 * unchanged); post-commit, write NOTHING and leave the journal at whatever non-terminal phase it
 * already reached (`VERIFYING`, set immediately after the transaction resolves, before either of
 * the two post-commit throw sites) — non-terminal is exactly what makes next-boot recovery pick it
 * up and restore from the pre-DDL snapshot. **CORRECTED below, same day**: leaving a non-terminal
 * phase behind turned out to trade one bug for a worse one — see POST-COMMIT DATA-LOSS WINDOW
 * immediately following this section for why "restore from the pre-DDL snapshot" is NOT the correct
 * outcome for this case, and what replaced `transactionCommitted`/`recordFailurePhase` instead.
 *
 * POST-COMMIT DATA-LOSS WINDOW (BUG FIX, 2026-08-12, same-day follow-up to the fix immediately
 * above): the fix above stopped LYING about a post-commit failure, but stopping the lie did not
 * stop the underlying failure from existing. A post-commit `verifyPostDdl` failure correctly wrote
 * nothing and left the entry at `VERIFYING` — but `VERIFYING` is non-terminal, and
 * `migration-recovery.ts` treats every non-terminal entry as a crash-interrupted attempt requiring
 * restore, indistinguishably from an actual process crash. The scenario this opened: DDL commits,
 * verification fails (a normal, catchable, in-process failure — the process does NOT crash),
 * `declareDataModule` returns `{ ok: false }`, and the site keeps running and serving traffic —
 * nothing about a caught, in-process exception stops that. Every write the site accepts from that
 * moment on, by ANY table, not just this plugin's, is exposed: the recovery snapshot is a
 * WHOLE-FILE backup (§4), and `restoreFromSnapshot` (`restore.ts`) is a whole-file copy back over
 * `dbPath`. The next time anything restarts the process — an operator's routine deploy, not a
 * crash — boot-time `recoverIncompleteDataModuleMigrations` finds the still-`VERIFYING` entry,
 * restores the whole db file to its pre-DDL state, and every write since is gone, with no crash and
 * no operator warning to explain why. Direct reproduction (both as a fault-injected `:memory:` case
 * and as a full write-after-failure/restart/verify-survival end-to-end case, see
 * `data-module.test.ts`) confirmed both the live-column retention AND the eventual data loss on
 * recovery; this was not a hypothetical.
 *
 * The root cause both this fix and the one above were reacting to is the same: `verifyPostDdl` ran
 * AFTER `db.transaction()` had already committed, so there was always going to be SOME failure mode
 * in that gap that a post-hoc phase label could describe accurately but never close. The actual fix
 * is to remove the gap: `verifyPostDdl` now runs as the LAST statement INSIDE the same
 * `db.transaction()` that runs the DDL, and a failure throws from inside that callback — the exact
 * same mechanism `applyTableCreate`/`applyTableAlteration` already use to fail the transaction, so
 * better-sqlite3's own automatic `ROLLBACK` undoes the DDL right along with it. There is no longer a
 * state where the DDL is live but unverified; verified-and-committed and rolled-back-entirely are
 * now the only two reachable outcomes. (Verification's own `PRAGMA table_info`/`index_list` reads
 * are unaffected by running mid-transaction — a SQLite connection sees its own uncommitted writes
 * within the same transaction exactly like committed ones, confirmed directly for this repo's
 * better-sqlite3 build; it is not merely inferred from general SQL semantics.)
 *
 * The journal's own `COMMITTED` transition moves inside the same transaction too, via
 * `migration-journal.ts`'s `stageJournalPhase` — a checkpoint-free write, because
 * `advanceJournalPhase` CANNOT be reused here: it calls `PRAGMA wal_checkpoint(FULL)`, and a
 * checkpoint issued by the SAME connection that holds an open write transaction throws `database
 * table is locked` (confirmed directly, not assumed — SQLite's own docs do not call out
 * same-connection mid-transaction checkpoint behavior at all, so this needed a real probe, not a
 * reading). Writing `COMMITTED` inside the DDL transaction means a crash at the worst possible
 * instant — literally between SQLite's internal commit and this function's `db.transaction()` call
 * returning to JS — still leaves the journal reading `COMMITTED`, because that write committed WITH
 * the DDL, as one indivisible unit; there is no instant at which live state and journal state can
 * disagree. `stagePhaseIfJournaled` no-ops for the in-memory case exactly like
 * `advancePhaseIfJournaled` does, matching this file's existing in-memory convention throughout.
 *
 * `declareDataModule`'s catch block goes back to unconditionally writing `ROLLED_BACK` — the
 * `transactionCommitted` flag and `recordFailurePhase`'s pre/post-commit fork the previous fix
 * introduced are gone, not because that reasoning was wrong but because it is now unreachable: with
 * verification and the `COMMITTED` write both inside the transaction, `db.transaction()` throwing
 * means SQLite really did roll everything back in every remaining case, so `ROLLED_BACK` is once
 * again always truthful — the same simplicity the very first version of this file had, restored
 * without reintroducing the bug that simplicity originally hid. The one sliver of risk that
 * remains — the belt-and-suspenders `advancePhaseIfJournaled(db, journalId, "COMMITTED")` checkpoint
 * call (re-writing the already-`COMMITTED` row purely to force its WAL merge), or
 * `discardSnapshotIfFileBacked`, throwing AFTER the transaction has already committed everything
 * that matters — is deliberately kept OUT of the catch path entirely: both calls run in their own
 * swallow-all block after the transaction succeeds, because by that point the migration is already
 * correct and durable, and reporting `{ ok: false }` for a housekeeping hiccup would itself be a lie
 * in the other direction (the same principle `discardCommittedSnapshot` already documents: "must
 * not turn a successful migration into a reported failure").
 *
 * T2 (§4's exclusive cross-process lock) is DELIBERATELY NOT acquired here — SPEC-033 correction
 * (2026-07-16), superseding SPEC-032's original implementation. The ADR's own §4 text scopes T2's
 * purpose narrowly: "The SQLite online backup API is safe under concurrent writers during
 * snapshot creation — that step needs no change here. Restore is a different, less-safe
 * operation" — the lock exists to guard RESTORE, not the live snapshot+DDL window. `restore.ts`'s
 * own header already establishes that restore never runs live in this codebase's actual topology
 * (single-process, single long-lived connection; restore only runs at boot-time recovery, before
 * any other connection exists) — so T2's stated danger literally cannot occur here. Holding a
 * real `PRAGMA locking_mode=EXCLUSIVE` during the live window instead caused a genuine,
 * deterministic production bug: a live multi-boot smoke test against the real server found the
 * store plugin's own separate `content.db` connection (`store-plugin.ts#bootstrapStore`) failing
 * boot with "database is locked" every time, confirmed via A/B testing (disabling the lock calls
 * made the failure disappear immediately) — the exact interleaving mechanism was not fully
 * root-caused (multiple fire-and-forget dataModule declares and other writers share one
 * long-lived connection in the real composition, unlike any isolated repro), but the causal link
 * to `locking_mode=EXCLUSIVE` was empirically conclusive. Removing an unneeded lock whose own
 * ADR-stated justification doesn't apply here, rather than debugging a specific interleaving
 * further, is the correct call.
 *
 * ADR-023 is ACCEPTED (2026-07-11) after a 3-round external audit whose T1-T8 findings are now
 * ALL reflected in code across this file, `migration-journal.ts`, `disk-headroom.ts`,
 * `plugin-identity.ts`, `migration-recovery.ts`, and `restore.ts` — see SPEC-032/SPEC-033 for the
 * full record of which finding lives where. This engine exists ahead of §12's "v1 ships seams
 * only" schedule: §12's own last line permits shipping it early "against a concrete demand
 * plugin," and Newsletter (`src/newsletter/data-module-manifest.ts`) is exactly that — a real
 * production consumer already calling this engine before this file's safety mechanics existed.
 *
 * STORAGE KERNEL (2026-09-28, storage plan P1): the engine runs on the storage kernel, so the same
 * declaration installs on SQLite, PGlite and Postgres. DDL text is unchanged on SQLite (column types
 * via `columnTypeSql`; Postgres gets text/bigint/double precision/bytea); live state is read through
 * the kernel's `listTables`/`listColumns`/`listIndexes` instead of `PRAGMA`s, with the same meaning.
 * The snapshot, disk-headroom check and phase journal run only for a file-backed SQLite database
 * (`recoverable` below): they exist for next-boot restore of a whole file. On Postgres/PGlite the DDL
 * and its bookkeeping commit in one crash-safe transaction, so an interrupted attempt leaves nothing
 * behind to restore — the same reasoning as the in-memory case above.
 *
 * NOTE (§0 access-control caveat): a Tier-3 in-process plugin could bypass this by opening the db
 * file directly. The RECOVERABILITY guarantee here (who snapshots + who runs DDL = core) holds
 * unconditionally for core-mediated DDL; the access-control framing is advisory until ADR-024 §4
 * Rung 2 (capability sandbox) ships — see ADR-023 §0 for the full, precise wording.
 */
import { sql } from "kysely";

import {
  autoIdColumnSql,
  columnTypeSql,
  type IndexInfo,
  listColumns,
  listIndexes,
  listTables,
} from "../kernel/index.js";
import { checkDiskHeadroom, type HeadroomCheck } from "./disk-headroom.js";
import { advanceJournalPhase, beginJournalEntry, ensureMigrationJournal, stageJournalPhase } from "./migration-journal.js";
import type { JournalPhase } from "./migration-journal.js";
import { checkNamespaceAdoption } from "./plugin-identity.js";
import type { PluginProvenance } from "./plugin-identity.js";
import { type PluginKernel, type PluginStore, pluginKernel } from "./plugin-store.js";
import { discardCommittedSnapshot, isInMemoryDbPath, snapshotDb } from "./snapshot.js";

export type ColumnType = "TEXT" | "INTEGER" | "REAL" | "BLOB";
export type PluginTier = "tier-1" | "tier-2" | "tier-3";

export interface ColumnDecl {
  readonly name: string;
  readonly type: ColumnType;
  readonly notNull?: boolean;
  readonly primaryKey?: boolean;
}

/**
 * ADR-023 §2 ("declared FKs") / ADR-031 OQ-1 (SDK stress-test finding) — the dataModule seam's
 * declared-index grammar. Comments' moderation-queue query pattern
 * (`workspace_id, entry_id, status`) is the concrete demand this grows the seam against, per
 * OQ-1's own instruction not to silently work around the gap. Deliberately NOT a foreign-key
 * declaration seam too — ADR-031 §2 itself says referential integrity to `entries`/parent
 * comments is "chokepoint-validated, not FK-enforced (v1)", so only indexes are the real,
 * load-bearing need; adding FK-declaration grammar with no consumer would be speculative.
 */
export interface IndexDecl {
  /** SHORT name; core prefixes it the same way tables are (`idx_p_{pluginId}__{name}`). */
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique?: boolean;
}

export interface TableDecl {
  /** SHORT name; core prefixes it with the reserved `p_{pluginId}__` namespace. */
  readonly name: string;
  readonly columns: readonly ColumnDecl[];
  readonly indexes?: readonly IndexDecl[];
  /** Share policy belongs to the table owner. Missing declarations still refuse nonempty data.
   * Portable columns are explicit so later personal fields cannot silently enter an archive. */
  readonly portability?: { readonly kind: "private" } | { readonly kind: "portable"; readonly columns: readonly string[] };
}

export interface DataModuleDecl {
  readonly pluginId: string;
  /** §3/T6: `dataModule` is scoped to Tier-2/Tier-3 only — a Tier-1 declaration is rejected. */
  readonly pluginTier: PluginTier;
  readonly tables: readonly TableDecl[];
  /** §5/§6/T5 — used by the namespace-adoption guard. */
  readonly provenance: PluginProvenance;
}

export interface DeclareResult {
  readonly ok: boolean;
  /** Fully-qualified names of tables created this call. */
  readonly created: string[];
  /**
   * Fully-qualified names of already-existing tables that had one or more declared columns added
   * and/or declared indexes added or recreated this call (the column- and index-level
   * reconciliation described in this file's header comment). A table name never appears in both
   * `created` and `altered` — it is either newly made or already existed.
   */
  readonly altered: string[];
  /** Path to the pre-DDL snapshot, or null when nothing needed doing / the input was invalid. */
  readonly snapshotPath: string | null;
  /** On failure: the snapshot that remains as the named recovery point (§9). */
  readonly recoveryPoint?: string | undefined;
  readonly error?: { code: string; message: string };
}

const IDENT = /^[a-z][a-z0-9_]*$/;
const TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>(["TEXT", "INTEGER", "REAL", "BLOB"]);

class DeclError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const fqName = (pluginId: string, name: string): string => `p_${pluginId}__${name}`;

/** Validate the declaration entirely before any I/O (§5 namespace + column shape + §3/T6 tier). */
/**
 * PostgreSQL's hard identifier ceiling (`NAMEDATALEN - 1`). SQLite has no limit at all, which is
 * exactly why this needs checking here rather than being discovered later: nothing in a
 * SQLite-only world ever fails, so a too-long name ships silently and only becomes a defect on a
 * Postgres-backed site.
 */
const MAX_IDENTIFIER_BYTES = 63;

/**
 * Fails a declaration whose generated identifier would exceed what PostgreSQL accepts.
 *
 * Why reject rather than truncate: PostgreSQL truncates over-long identifiers *silently* — no
 * error, no warning. The name in the catalog then differs from the name this module computed, so
 * `existingTables`-style idempotency checks look for a name that is not there, conclude the object
 * is missing, and try to create it again on every activation. Failing closed at declare time (like
 * every other check in this function, all of which run before any I/O) turns a silent divergence on
 * one backend into an install-time error the plugin author sees immediately.
 *
 * Measured headroom at the time this was added: the longest live identifier is 42 bytes
 * (the comments plugin's moderation-queue index), so no existing plugin is affected. The budget a
 * plugin author actually has is `pluginId + tableName + indexName <= 53` for an index, since the
 * `idx_`, `p_`, and two `__` separators consume the other 10.
 */
function assertIdentifierFits(identifier: string, what: string): void {
  if (Buffer.byteLength(identifier, "utf8") <= MAX_IDENTIFIER_BYTES) return;
  throw new DeclError(
    "IDENTIFIER_TOO_LONG",
    `${what} generates the identifier "${identifier}" (${Buffer.byteLength(identifier, "utf8")} bytes), ` +
      `which exceeds PostgreSQL's ${MAX_IDENTIFIER_BYTES}-byte limit and would be silently truncated. ` +
      `Shorten the plugin id, table name, or index name.`
  );
}

/**
 * Validates one table's columns and returns the set of names its indexes are allowed to reference.
 *
 * Returning the set rather than recomputing it in the index pass is what keeps the two loops
 * independent — an index can only be checked against columns this same table declared, and pulling
 * that dependency out into a return value is what allows both loops to be top-level functions
 * rather than nested inside `validate`.
 */
function validateColumns(table: TableDecl): Set<string> {
  if (table.columns.length === 0) throw new DeclError("NO_COLUMNS", `table ${table.name} declares no columns`);
  const declaredColumns = new Set<string>();
  for (const col of table.columns) {
    if (!IDENT.test(col.name)) throw new DeclError("BAD_COLUMN", `invalid column name: ${col.name}`);
    if (!TYPES.has(col.type)) throw new DeclError("BAD_TYPE", `unsupported column type for ${col.name}: ${col.type}`);
    declaredColumns.add(col.name);
  }
  return declaredColumns;
}

/** Validates one index's declared columns against the table's actual columns — declared at TOP
 *  LEVEL (not a closure inside `validateIndexes`' loop) so it does not inherit that loop's own
 *  nesting; see `validate()`'s own doc above for why a nested closure would change nothing. */
function validateIndexColumns(idx: IndexDecl, table: TableDecl, declaredColumns: Set<string>): void {
  if (idx.columns.length === 0) throw new DeclError("EMPTY_INDEX", `index ${idx.name} on table ${table.name} declares no columns`);
  for (const col of idx.columns) {
    if (!declaredColumns.has(col)) {
      throw new DeclError("INDEX_UNKNOWN_COLUMN", `index ${idx.name} on table ${table.name} references undeclared column: ${col}`);
    }
  }
}

/** Validates one table's index declarations against the columns that table actually declared. */
function validateIndexes(pluginId: string, table: TableDecl, declaredColumns: Set<string>): void {
  for (const idx of table.indexes ?? []) {
    if (!IDENT.test(idx.name)) throw new DeclError("BAD_INDEX_NAME", `invalid index name: ${idx.name}`);
    assertIdentifierFits(`idx_${fqName(pluginId, table.name)}__${idx.name}`, `index ${idx.name} on table ${table.name}`);
    validateIndexColumns(idx, table, declaredColumns);
  }
}

/** Validates one table declaration end to end: name, generated identifier length, columns, indexes. */
function validateTable(pluginId: string, table: TableDecl): void {
  if (!IDENT.test(table.name)) throw new DeclError("BAD_TABLE_NAME", `invalid table name: ${table.name}`);
  assertIdentifierFits(fqName(pluginId, table.name), `table ${table.name}`);
  validateIndexes(pluginId, table, validateColumns(table));
}

/**
 * Every declaration check, run before any I/O so the whole engine fails closed on a bad manifest.
 *
 * Split into `validateTable`/`validateColumns`/`validateIndexes` rather than one nested triple
 * loop: as a single function this measured cyclomatic 16 / cognitive 31 against this repo's
 * ceiling of 10 for both. The nesting was the cognitive driver — SonarJS charges depth to every
 * control-flow structure inside an enclosing loop, so extraction has to be to **top level** to pay
 * off. A closure declared inside the loop body would inherit the loop's nesting and change nothing.
 */
function validate(decl: DataModuleDecl): void {
  if (!IDENT.test(decl.pluginId)) throw new DeclError("BAD_PLUGIN_ID", `invalid pluginId: ${decl.pluginId}`);
  if (decl.pluginTier === "tier-1") {
    throw new DeclError("TIER1_NOT_ALLOWED", "dataModule requires executable code (Tier-2 or Tier-3); Tier-1 plugins cannot request it");
  }
  if (decl.tables.length === 0) throw new DeclError("EMPTY", "declaration lists no tables");
  for (const table of decl.tables) validateTable(decl.pluginId, table);
}

/**
 * One column's DDL. Identifiers are validated (`IDENT`) before any DDL is built, so quoting them
 * into the text is safe; the type is the dialect's spelling of the declared affinity (unchanged on
 * SQLite). The same text is what `_plugin_migrations.ddl` records.
 */
function columnSql(kernel: PluginKernel, col: ColumnDecl): string {
  let ddl = `"${col.name}" ${columnTypeSql(kernel.dialect, col.type)}`;
  if (col.primaryKey) ddl += " PRIMARY KEY";
  if (col.notNull) ddl += " NOT NULL";
  return ddl;
}

/** Runs one DDL statement this module built from validated identifiers. */
async function executeDdl(kernel: PluginKernel, ddl: string): Promise<void> {
  await kernel.execute(sql.raw(ddl));
}

function indexSql(fqTableName: string, idx: IndexDecl): { indexName: string; sql: string } {
  const indexName = `idx_${fqTableName}__${idx.name}`;
  const unique = idx.unique ? "UNIQUE " : "";
  const columns = idx.columns.map((c) => `"${c}"`).join(", ");
  return { indexName, sql: `CREATE ${unique}INDEX "${indexName}" ON "${fqTableName}" (${columns})` };
}

/** Core's own migration timeline, extended to admit plugin entries later (ADR-023 §12). */
async function ensureJournal(kernel: PluginKernel): Promise<void> {
  const text = sql.raw(columnTypeSql(kernel.dialect, "TEXT"));
  await kernel.execute(sql`CREATE TABLE IF NOT EXISTS _plugin_migrations (
       id ${sql.raw(autoIdColumnSql(kernel.dialect))},
       plugin_id ${text} NOT NULL,
       table_name ${text} NOT NULL,
       ddl ${text} NOT NULL,
       snapshot_path ${text},
       at ${sql.raw(columnTypeSql(kernel.dialect, "INTEGER"))} NOT NULL
     )`);
}

async function existingTables(kernel: PluginKernel, names: string[]): Promise<Set<string>> {
  if (names.length === 0) return new Set();
  const wanted = new Set(names);
  return new Set((await listTables(kernel)).filter((name) => wanted.has(name)));
}

interface ExistingColumnInfo {
  /** Lower-case, as `listColumns` reports it. */
  readonly type: string;
  readonly notNull: boolean;
  readonly primaryKey: boolean;
}

/**
 * A plan to ALTER an already-existing table: declared-but-missing columns to add, declared
 * indexes missing live to add, and declared indexes whose live shape no longer matches to drop
 * and recreate (see this file's header comment, INDEX-LEVEL RECONCILIATION).
 */
interface TableAlterationPlan {
  readonly fqTableName: string;
  readonly columnsToAdd: readonly ColumnDecl[];
  readonly indexesToAdd: readonly IndexDecl[];
  readonly indexesToRecreate: readonly IndexDecl[];
}

interface ReconciliationPlan {
  readonly toCreate: readonly TableDecl[];
  readonly toAlter: readonly TableAlterationPlan[];
}

/**
 * Reads `fqTableName`'s live column shape through the kernel's `listColumns` (SQLite:
 * `pragma_table_info`, whose ordinal `pk` it already reads as "is part of the primary key").
 */
async function getExistingColumns(kernel: PluginKernel, fqTableName: string): Promise<Map<string, ExistingColumnInfo>> {
  const columns = await listColumns(kernel, fqTableName);
  return new Map(columns.map((c) => [c.name, { type: c.type, notNull: c.notNull, primaryKey: c.primaryKey }]));
}

/**
 * Decides whether a declared-but-missing column on an already-existing table is safely addable
 * via `ALTER TABLE ADD COLUMN`, throwing a fail-closed `DeclError` for the two cases SQLite
 * cannot express as an `ADD COLUMN` at all (see this file's header comment for the full
 * reasoning). Returns `col` unchanged when it is safe to add.
 */
function planMissingColumn(tableName: string, col: ColumnDecl): ColumnDecl {
  if (col.primaryKey) {
    throw new DeclError(
      "COLUMN_ADD_PRIMARY_KEY",
      `table ${tableName} is missing declared column "${col.name}", which is a PRIMARY KEY. ` +
        `SQLite's ALTER TABLE has no way to add a primary key to an existing table — only a full ` +
        `table rebuild can, and this engine does not perform rebuilds. Ship "${col.name}" under a ` +
        `new table name instead, or coordinate an explicit, out-of-band migration.`
    );
  }
  if (col.notNull) {
    throw new DeclError(
      "COLUMN_ADD_NOT_NULL_WITHOUT_DEFAULT",
      `table ${tableName} is missing declared column "${col.name}", declared NOT NULL. SQLite's ` +
        `ALTER TABLE ADD COLUMN refuses a NOT NULL column unless a non-NULL default is also given, ` +
        `and this declaration grammar (ColumnDecl) has no default field to supply one. Declare ` +
        `"${col.name}" as nullable (omit notNull) so it can be added, and enforce NOT NULL at the ` +
        `application layer, or backfill it before requiring the constraint here.`
    );
  }
  return col;
}

/**
 * Fails closed when a column that already exists on the live table no longer matches its
 * declared type. A type change (e.g. TEXT → INTEGER) needs a table rebuild, the same as the
 * missing-column PRIMARY KEY case above — this module never attempts one.
 */
function assertColumnTypeMatches(kernel: PluginKernel, tableName: string, col: ColumnDecl, existingCol: ExistingColumnInfo): void {
  // Type names compare case-insensitively (SQLite's own rule): `listColumns` reports lower case.
  if (existingCol.type === columnTypeSql(kernel.dialect, col.type).toLowerCase()) return;
  throw new DeclError(
    "COLUMN_TYPE_MISMATCH",
    `table ${tableName} column "${col.name}" is declared ${col.type} but the live column is ` +
      `${existingCol.type.toUpperCase()}. Changing a column's type needs a table rebuild, which this engine ` +
      `does not perform.`
  );
}

/**
 * Fails closed when a column that already exists on the live table no longer matches its
 * declared `NOT NULL` constraint, in EITHER direction (see this file's header comment,
 * CONSTRAINT-LEVEL RECONCILIATION, for why this is deliberately symmetric rather than only
 * catching the tightening direction). SQLite's `ALTER TABLE` cannot flip `NOT NULL` on an
 * existing column either way without a table rebuild, the same reason `assertColumnTypeMatches`
 * fails closed on a type change.
 */
function assertColumnNotNullMatches(kernel: PluginKernel, tableName: string, col: ColumnDecl, existingCol: ExistingColumnInfo): void {
  // Postgres makes every PRIMARY KEY column NOT NULL; SQLite does not (a legacy quirk it keeps).
  const declaredNotNull = (col.notNull ?? false) || (kernel.dialect === "postgres" && col.primaryKey === true);
  if (existingCol.notNull === declaredNotNull) return;
  throw new DeclError(
    "COLUMN_NOT_NULL_MISMATCH",
    `table ${tableName} column "${col.name}" is declared ${declaredNotNull ? "NOT NULL" : "nullable"} but ` +
      `the live column is ${existingCol.notNull ? "NOT NULL" : "nullable"}. Changing a column's NOT NULL ` +
      `constraint needs a table rebuild, which this engine does not perform.`
  );
}

/**
 * Fails closed when a column that already exists on the live table no longer matches its
 * declared `PRIMARY KEY` membership, in EITHER direction (same symmetric reasoning as
 * `assertColumnNotNullMatches`). Compares against `existingCol.primaryKey`, which
 * `getExistingColumns` already normalizes from `PRAGMA table_info`'s ordinal `pk` column via
 * `pk !== 0` — see this file's header comment for why that read is what keeps a composite primary
 * key from producing a false positive here.
 */
function assertColumnPrimaryKeyMatches(tableName: string, col: ColumnDecl, existingCol: ExistingColumnInfo): void {
  const declaredPrimaryKey = col.primaryKey ?? false;
  if (existingCol.primaryKey === declaredPrimaryKey) return;
  throw new DeclError(
    "COLUMN_PRIMARY_KEY_MISMATCH",
    `table ${tableName} column "${col.name}" is declared ${declaredPrimaryKey ? "a PRIMARY KEY" : "not a PRIMARY KEY"} ` +
      `but the live column ${existingCol.primaryKey ? "is" : "is not"} part of the table's primary key. SQLite's ` +
      `ALTER TABLE cannot add or remove a primary key on an existing table — only a full table rebuild can, ` +
      `and this engine does not perform rebuilds.`
  );
}

/**
 * Diffs one already-existing table's declared columns against its live shape (§2's own text:
 * "diffs declared-state against live-state"). A live column absent from `table.columns` is
 * deliberately not inspected here at all — see this file's header comment for why that drift is
 * left alone rather than dropped.
 */
async function planColumnReconciliation(kernel: PluginKernel, table: TableDecl, fqTableName: string): Promise<ColumnDecl[]> {
  const existingColumns = await getExistingColumns(kernel, fqTableName);
  const columnsToAdd: ColumnDecl[] = [];
  for (const col of table.columns) {
    const existingCol = existingColumns.get(col.name);
    if (existingCol === undefined) {
      columnsToAdd.push(planMissingColumn(table.name, col));
      continue;
    }
    assertColumnTypeMatches(kernel, table.name, col, existingCol);
    assertColumnNotNullMatches(kernel, table.name, col, existingCol);
    assertColumnPrimaryKeyMatches(table.name, col, existingCol);
  }
  return columnsToAdd;
}

/** True when a declared index's shape (column list, in order, and uniqueness) matches its live index. */
function indexMatches(idx: IndexDecl, existing: IndexInfo): boolean {
  const declaredUnique = idx.unique ?? false;
  if (existing.unique !== declaredUnique) return false;
  if (existing.columns.length !== idx.columns.length) return false;
  return existing.columns.every((col, i) => col === idx.columns[i]);
}

interface IndexReconciliationPlan {
  readonly indexesToAdd: readonly IndexDecl[];
  readonly indexesToRecreate: readonly IndexDecl[];
}

/**
 * Diffs one already-existing table's declared indexes against its live shape (see this file's
 * header comment, INDEX-LEVEL RECONCILIATION, for the full reasoning behind `indexesToAdd` vs.
 * `indexesToRecreate` vs. leaving an undeclared live index alone).
 *
 * The kernel's `listIndexes` keys explicitly-authored indexes by their live names. Only
 * `CREATE INDEX` indexes are listed — the implicit ones a `UNIQUE` column constraint or a
 * `PRIMARY KEY` makes (SQLite origin `u`/`pk`, e.g. `sqlite_autoindex_*`; Postgres constraint-backed
 * indexes) were never declared through `IndexDecl` or created by this module's own `indexSql`.
 */
async function planIndexReconciliation(kernel: PluginKernel, table: TableDecl, fqTableName: string): Promise<IndexReconciliationPlan> {
  const existingIndexes = await listIndexes(kernel, fqTableName);
  const indexesToAdd: IndexDecl[] = [];
  const indexesToRecreate: IndexDecl[] = [];
  for (const idx of table.indexes ?? []) {
    const { indexName } = indexSql(fqTableName, idx);
    const existing = existingIndexes.get(indexName);
    if (existing === undefined) {
      indexesToAdd.push(idx);
      continue;
    }
    if (!indexMatches(idx, existing)) indexesToRecreate.push(idx);
  }
  return { indexesToAdd, indexesToRecreate };
}

/**
 * Builds the full reconciliation plan for a validated declaration: which declared tables don't
 * exist yet at all (`toCreate`, the pre-existing behavior) and which already-existing tables need
 * one or more columns added and/or indexes added or recreated (`toAlter`). Throws a fail-closed
 * `DeclError` if any existing table's live column shape can't be reconciled by a plain
 * `ALTER TABLE ADD COLUMN` — index drift never throws here; see `planIndexReconciliation`.
 */
async function planReconciliation(
  kernel: PluginKernel,
  decl: DataModuleDecl,
  existingTableNames: ReadonlySet<string>
): Promise<ReconciliationPlan> {
  const toCreate: TableDecl[] = [];
  const toAlter: TableAlterationPlan[] = [];
  for (const table of decl.tables) {
    const fqTableName = fqName(decl.pluginId, table.name);
    if (!existingTableNames.has(fqTableName)) {
      toCreate.push(table);
      continue;
    }
    const columnsToAdd = await planColumnReconciliation(kernel, table, fqTableName);
    const { indexesToAdd, indexesToRecreate } = await planIndexReconciliation(kernel, table, fqTableName);
    if (columnsToAdd.length > 0 || indexesToAdd.length > 0 || indexesToRecreate.length > 0) {
      toAlter.push({ fqTableName, columnsToAdd, indexesToAdd, indexesToRecreate });
    }
  }
  return { toCreate, toAlter };
}

/** Records one applied DDL statement in the site-wide migration timeline (dedupes what was 3 inline call sites). */
async function recordMigration(
  kernel: PluginKernel,
  pluginId: string,
  objectName: string,
  ddl: string,
  snapshotPath: string | null,
  at: number
): Promise<void> {
  await kernel.run((db) =>
    db
      .insertInto("_plugin_migrations")
      .values({ plugin_id: pluginId, table_name: objectName, ddl, snapshot_path: snapshotPath, at })
      .execute()
  );
}

/**
 * Re-reads one altered table's live indexes and reports any declared-added-or-recreated index
 * (`indexesToAdd` or `indexesToRecreate`) not actually there under its generated name. Indexes on
 * a brand-new table (`plan.toCreate`) are pre-existing, out-of-scope-for-this-fix behavior — this
 * only covers the alter path this fix adds, matching `missingColumns`'s scope one level up.
 */
async function verifyAlteredIndexes(kernel: PluginKernel, alteration: TableAlterationPlan): Promise<string[]> {
  const nowExistingIndexes = await listIndexes(kernel, alteration.fqTableName);
  const declaredIndexes = [...alteration.indexesToAdd, ...alteration.indexesToRecreate];
  return declaredIndexes
    .map((idx) => indexSql(alteration.fqTableName, idx).indexName)
    .filter((indexName) => !nowExistingIndexes.has(indexName))
    .map((indexName) => `index ${indexName}`);
}

/**
 * Post-DDL sanity check (§2): re-reads live state and returns a description of anything the DDL
 * just run in this same transaction claims to have applied but that isn't actually there. Empty
 * means the DDL is confirmed applied; a non-empty result makes the caller throw (see
 * `declareDataModule`, POST-COMMIT DATA-LOSS WINDOW in this file's header) — called as the LAST
 * statement inside the DDL transaction, so a non-empty result rolls the whole transaction back
 * atomically with the DDL, even though SQLite itself reported no DDL error. `PRAGMA table_info` /
 * `index_list` reads mid-transaction see this transaction's own uncommitted writes exactly like
 * committed ones (same connection, standard SQLite read-your-writes semantics — confirmed directly,
 * not merely assumed), so this check is exactly as sensitive to a real drift now as it was
 * post-commit.
 */
async function verifyPostDdl(kernel: PluginKernel, decl: DataModuleDecl, plan: ReconciliationPlan): Promise<string[]> {
  const createdNames = plan.toCreate.map((t) => fqName(decl.pluginId, t.name));
  const nowExistingTables = await existingTables(kernel, createdNames);
  const missingTables = createdNames.filter((name) => !nowExistingTables.has(name));
  const missingColumns: string[] = [];
  const missingIndexes: string[] = [];
  for (const alteration of plan.toAlter) {
    const nowExisting = await getExistingColumns(kernel, alteration.fqTableName);
    for (const c of alteration.columnsToAdd) {
      if (!nowExisting.has(c.name)) missingColumns.push(`${alteration.fqTableName}.${c.name}`);
    }
    missingIndexes.push(...(await verifyAlteredIndexes(kernel, alteration)));
  }
  return [...missingTables, ...missingColumns, ...missingIndexes];
}

/** Namespace-adoption (§5/§6/T5) and disk-headroom (§3/T4) preflight, both fail-closed, before any snapshot/lock/DDL. */
async function runPreflightChecks(
  kernel: PluginKernel,
  dbPath: string,
  decl: DataModuleDecl,
  recoverable: boolean,
  checkHeadroom: (required: { dbPath: string }, optional?: Record<string, never>) => HeadroomCheck
): Promise<{ ok: true } | { ok: false; error: { code: string; message: string } }> {
  const adoption = await checkNamespaceAdoption({ db: kernel, pluginId: decl.pluginId, provenance: decl.provenance });
  if (!adoption.allowed) {
    return { ok: false, error: { code: "IDENTITY_ADOPTION_REQUIRES_CONSENT", message: adoption.reason } };
  }
  // Headroom is for the snapshot file, so only a recoverable (file-backed SQLite) database needs it.
  // `checkDiskHeadroom` itself also no-ops to `ok: true` for an in-memory `dbPath` (BUG FIX 2026-07-28).
  if (!recoverable) return { ok: true };
  const headroom = checkHeadroom({ dbPath });
  if (!headroom.ok) {
    return {
      ok: false,
      error: {
        code: "INSUFFICIENT_DISK_HEADROOM",
        message: `dataModule declare refused: needs ~${headroom.requiredBytes} bytes free, only ${headroom.freeBytes ?? "unknown"} available`,
      },
    };
  }
  return { ok: true };
}

/**
 * Opens the phase journal only when there's a real file behind `snapshotPath` to recover to — an
 * in-memory db has no next boot to recover at (see this file's header comment), so `journalId`
 * stays null and every phase transition below becomes a no-op for that case.
 */
async function openJournalIfFileBacked(kernel: PluginKernel, pluginId: string, snapshotPath: string | null): Promise<number | null> {
  if (snapshotPath === null) return null;
  await ensureMigrationJournal({ store: kernel });
  return beginJournalEntry({ db: kernel, pluginId, snapshotPath });
}

/** No-ops when there is no journal entry to advance (in-memory `dbPath` case). */
async function advancePhaseIfJournaled(kernel: PluginKernel, journalId: number | null, phase: JournalPhase): Promise<void> {
  if (journalId === null) return;
  await advanceJournalPhase({ db: kernel, id: journalId, phase });
}

/**
 * No-ops when there is no journal entry to advance (in-memory `dbPath` case, matching
 * `advancePhaseIfJournaled`'s own guard) — but writes WITHOUT checkpointing, for use strictly
 * inside an already-open kernel transaction on the same connection (see `migration-journal.ts`'s
 * `stageJournalPhase` and this file's header comment, POST-COMMIT DATA-LOSS WINDOW, for why a
 * checkpoint cannot run there).
 */
async function stagePhaseIfJournaled(kernel: PluginKernel, journalId: number | null, phase: JournalPhase): Promise<void> {
  if (journalId === null) return;
  await stageJournalPhase({ db: kernel, id: journalId, phase });
}

/** Runs one `CREATE INDEX` and records it. Shared by the create-table path and the add-index alter path. */
async function applyIndexAdd(
  kernel: PluginKernel,
  pluginId: string,
  fqTableName: string,
  idx: IndexDecl,
  snapshotPath: string | null,
  at: number
): Promise<void> {
  const { indexName, sql: createDdl } = indexSql(fqTableName, idx);
  await executeDdl(kernel, createDdl);
  await recordMigration(kernel, pluginId, indexName, createDdl, snapshotPath, at);
}

/**
 * Drops then recreates one index whose live shape no longer matches its declaration (this file's
 * header comment, INDEX-LEVEL RECONCILIATION) — two DDL statements, both recorded, both inside the
 * caller's single transaction so either one failing rolls both back together with everything else.
 */
async function applyIndexRecreate(
  kernel: PluginKernel,
  pluginId: string,
  fqTableName: string,
  idx: IndexDecl,
  snapshotPath: string | null,
  at: number
): Promise<void> {
  const { indexName } = indexSql(fqTableName, idx);
  const dropDdl = `DROP INDEX "${indexName}"`;
  await executeDdl(kernel, dropDdl);
  await recordMigration(kernel, pluginId, indexName, dropDdl, snapshotPath, at);
  await applyIndexAdd(kernel, pluginId, fqTableName, idx, snapshotPath, at);
}

/** Creates one brand-new table and its declared indexes, inside the caller's transaction. Returns the fully-qualified name created. */
async function applyTableCreate(kernel: PluginKernel, pluginId: string, table: TableDecl, snapshotPath: string | null, at: number): Promise<string> {
  const name = fqName(pluginId, table.name);
  // No IF NOT EXISTS: a within-call duplicate is a malformed manifest → fail → roll back.
  const ddl = `CREATE TABLE "${name}" (${table.columns.map((col) => columnSql(kernel, col)).join(", ")})`;
  await executeDdl(kernel, ddl);
  await recordMigration(kernel, pluginId, name, ddl, snapshotPath, at);
  for (const idx of table.indexes ?? []) await applyIndexAdd(kernel, pluginId, name, idx, snapshotPath, at);
  return name;
}

/** Applies one already-existing table's queued column additions and index add/recreate, inside the caller's transaction. */
async function applyTableAlteration(
  kernel: PluginKernel,
  pluginId: string,
  alteration: TableAlterationPlan,
  snapshotPath: string | null,
  at: number
): Promise<void> {
  for (const col of alteration.columnsToAdd) {
    const ddl = `ALTER TABLE "${alteration.fqTableName}" ADD COLUMN ${columnSql(kernel, col)}`;
    await executeDdl(kernel, ddl);
    await recordMigration(kernel, pluginId, alteration.fqTableName, ddl, snapshotPath, at);
  }
  for (const idx of alteration.indexesToRecreate) await applyIndexRecreate(kernel, pluginId, alteration.fqTableName, idx, snapshotPath, at);
  for (const idx of alteration.indexesToAdd) await applyIndexAdd(kernel, pluginId, alteration.fqTableName, idx, snapshotPath, at);
}

/** Completes housekeeping after the DDL and its COMMITTED journal marker are durable. */
async function finishCommittedMigration(
  { kernel, journalId, snapshotPath }: { kernel: PluginKernel; journalId: number | null; snapshotPath: string | null },
  _optional: Record<string, never> = {}
): Promise<void> {
  // The transaction already committed the DDL AND the journal's "COMMITTED" marker
  // atomically and durably (SQLite's own WAL commit) — recovery already reads this attempt
  // correctly even if nothing below this line ever runs. What follows is housekeeping only:
  // `advancePhaseIfJournaled` re-writes the (already correct) row purely to force the WAL→main-file
  // checkpoint `stagePhaseIfJournaled` could not request from inside the open transaction (see
  // migration-journal.ts); `discardCommittedSnapshot` deletes a snapshot the never-brick
  // guarantee no longer needs (see the inline comment on `discardCommittedSnapshot`). Neither can
  // undo a result that is already correct, so neither failing here is reported as a migration
  // failure — matching `discardCommittedSnapshot`'s own "must not turn a successful migration into
  // a reported failure" contract.
  try {
    await advancePhaseIfJournaled(kernel, journalId, "COMMITTED");
    // No-ops when no snapshot file was ever written (in-memory `dbPath` case) — nothing to discard.
    if (snapshotPath === null) return;
    await discardCommittedSnapshot({ snapshotPath });
  } catch {
    // Best-effort only — see the comment above. The migration itself already succeeded.
  }
}

/**
 * Declare (reconcile) a plugin's tables. Core snapshots first, then runs the DDL transactionally.
 *
 * `db` is the storage kernel (or a SQLite connection, bridged to its kernel). `dbPath` names the
 * SQLite file behind it, for the snapshot; it is ignored for a Postgres/PGlite kernel.
 * `checkHeadroom` replaces only disk measurement; the existing disk-headroom adapter is the default.
 */
export async function declareDataModule(
  required: { db: PluginStore; dbPath: string; decl: DataModuleDecl },
  { checkHeadroom = ({ dbPath }, _optional = {}) => checkDiskHeadroom({ dbPath }) }: {
    checkHeadroom?: (required: { dbPath: string }, optional?: Record<string, never>) => HeadroomCheck;
  } = {}
): Promise<DeclareResult> {
  const { dbPath, decl } = required;
  const kernel = pluginKernel({ store: required.db });
  let plan: ReconciliationPlan;
  try {
    // Validate entirely before any I/O (§5 namespace + column shape + §3/T6 tier), then diff
    // declared-state against live-state (§2) — both table presence AND, for a table that already
    // exists, its declared columns against its live columns (this file's header comment).
    validate(decl);
    kernel.require("transactionalDdl");
    const fq = decl.tables.map((t) => fqName(decl.pluginId, t.name));
    const existing = await existingTables(kernel, fq);
    plan = await planReconciliation(kernel, decl, existing);
  } catch (err) {
    const e = err as DeclError;
    return { ok: false, created: [], altered: [], snapshotPath: null, error: { code: e.code, message: e.message } };
  }

  if (plan.toCreate.length + plan.toAlter.length === 0) {
    return { ok: true, created: [], altered: [], snapshotPath: null }; // idempotent no-op — nothing to snapshot
  }

  // Snapshot + journal exist for next-boot restore of a whole SQLite file (this file's header,
  // STORAGE KERNEL): nothing to restore for an in-memory db or a Postgres/PGlite kernel.
  const recoverable = kernel.dialect === "sqlite" && !isInMemoryDbPath({ dbPath });
  const preflight = await runPreflightChecks(kernel, dbPath, decl, recoverable, checkHeadroom);
  if (!preflight.ok) {
    return { ok: false, created: [], altered: [], snapshotPath: null, error: preflight.error };
  }

  // §4 — snapshot the WHOLE db BEFORE any DDL. This is the never-brick anchor.
  // `snapshotDb` returns `null` for an in-memory `dbPath` (BUG FIX 2026-07-28, see `snapshot.ts`) —
  // no file was ever written, so there is nothing to journal a recovery pointer to.
  const snapshotPath = recoverable ? await snapshotDb({ db: kernel, dbPath, label: decl.pluginId }) : null;

  // The phase-journal (§2/T3) exists solely to let `migration-recovery.ts` restore a crash-
  // interrupted attempt at NEXT BOOT. An in-memory db has no next boot — the whole database
  // vanishes with the process — so there is nothing for the journal to ever recover, and
  // `_plugin_migration_journal.snapshot_path` is `NOT NULL` (see `migration-journal.ts`) and could
  // not hold a null `snapshotPath` even if we tried. `journalId` stays `null` and every phase
  // transition below is then a no-op for this case; the transaction's own same-process rollback
  // (§9, the only failure mode a same-process in-memory db can ever hit) is unaffected and remains
  // the complete safety net.
  const journalId = await openJournalIfFileBacked(kernel, decl.pluginId, snapshotPath);

  const created: string[] = [];
  const altered: string[] = [];
  try {
    await advancePhaseIfJournaled(kernel, journalId, "DDL_IN_PROGRESS");
    // One transaction for ALL DDL — new tables, column additions, and index add/recreate on
    // existing tables — PLUS the post-DDL verification AND the journal's own COMMITTED write (this
    // file's header comment, POST-COMMIT DATA-LOSS WINDOW). Folding all four into one atomic unit
    // is what makes "the DDL committed" and "the journal says COMMITTED" the same fact: either this
    // whole callback returns and every one of those things is durably true together, or it throws
    // and the kernel rolls every one of them back together (§9).
    await kernel.transaction(async () => {
      await ensureJournal(kernel);
      const at = Date.now();
      for (const table of plan.toCreate) created.push(await applyTableCreate(kernel, decl.pluginId, table, snapshotPath, at));
      for (const alteration of plan.toAlter) {
        await applyTableAlteration(kernel, decl.pluginId, alteration, snapshotPath, at);
        altered.push(alteration.fqTableName);
      }
      const problems = await verifyPostDdl(kernel, decl, plan);
      if (problems.length > 0) {
        throw new Error(`post-DDL verification failed: ${problems.join(", ")} not found after DDL`);
      }
      await stagePhaseIfJournaled(kernel, journalId, "COMMITTED");
    });
  } catch (err) {
    // `kernel.transaction()` above threw — DDL, verification, and the in-transaction "COMMITTED" write
    // are now one atomic unit, so the transaction's own rollback really did undo ALL of them; the
    // live db is unchanged and working (same-process, catchable-failure case — no restore needed,
    // restore only ever runs at next-boot recovery for a CRASH, see migration-recovery.ts).
    // `ROLLED_BACK` is therefore always truthful here now (this file's header comment, POST-COMMIT
    // DATA-LOSS WINDOW) — there is no remaining case where this catch fires with the DDL actually
    // live. The snapshot remains as the named recovery point (§9) for operator forensics; for an
    // in-memory db, `snapshotPath`/`journalId` are both null (see above) — the same-process
    // rollback just performed IS the full recovery, no crash-recovery boot path can ever exist for
    // `:memory:` to need one.
    await advancePhaseIfJournaled(kernel, journalId, "ROLLED_BACK");
    const e = err as Error;
    return {
      ok: false,
      created: [],
      altered: [],
      snapshotPath,
      recoveryPoint: snapshotPath ?? undefined,
      error: { code: "DDL_FAILED", message: e.message },
    };
  }

  await finishCommittedMigration({ kernel, journalId, snapshotPath });

  return { ok: true, created, altered, snapshotPath };
}
