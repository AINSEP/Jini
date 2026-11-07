/**
 * @file ADR-023 §2 (T3 fix) — the durable, fsynced phase-marker journal for the dataModule
 * engine. Every DDL attempt writes phase transitions here, in strict sequence:
 * `PREPARED_SNAPSHOT → DDL_IN_PROGRESS → VERIFYING → COMMITTED` (success) or `→ ROLLED_BACK`
 * (failure). Each transition is checkpointed (forced WAL fsync) before the corresponding DB
 * operation is attempted, so a crash can always be placed at a known, durable phase on next boot.
 *
 * One row per attempt, phase column UPDATEd in place (not append-only) — boot recovery
 * (`migration-recovery.ts`) needs to find "the" in-flight entry per plugin cheaply.
 *
 * On the storage kernel, every dialect: `data-module.ts` only opens entries for a file-backed
 * SQLite database (the one with a snapshot to restore), but the table and its queries are portable.
 */
import { sql } from "kysely";

import { autoIdColumnSql, checkpointWal, columnTypeSql } from "../kernel/index.js";
import { type PluginKernel, type PluginStore, pluginKernel } from "./plugin-store.js";

export type JournalPhase = "PREPARED_SNAPSHOT" | "DDL_IN_PROGRESS" | "VERIFYING" | "COMMITTED" | "ROLLED_BACK";

export interface JournalEntry {
  id: number;
  pluginId: string;
  phase: JournalPhase;
  snapshotPath: string;
  startedAt: number;
  updatedAt: number;
}

const TERMINAL_PHASES: ReadonlySet<JournalPhase> = new Set(["COMMITTED", "ROLLED_BACK"]);

/** True for an entry boot recovery must act on: any phase short of `COMMITTED`/`ROLLED_BACK`. */
export function isIncompletePhase(
  { phase }: { phase: string },
  _optional: Record<string, never> = {}
): boolean {
  return !TERMINAL_PHASES.has(phase as JournalPhase);
}

export async function ensureMigrationJournal(
  { store }: { store: PluginStore },
  _optional: Record<string, never> = {}
): Promise<void> {
  const kernel = pluginKernel({ store });
  const integer = sql.raw(columnTypeSql(kernel.dialect, "INTEGER"));
  const text = sql.raw(columnTypeSql(kernel.dialect, "TEXT"));
  await kernel.execute(sql`CREATE TABLE IF NOT EXISTS _plugin_migration_journal (
       id ${sql.raw(autoIdColumnSql(kernel.dialect))},
       plugin_id ${text} NOT NULL,
       phase ${text} NOT NULL,
       snapshot_path ${text} NOT NULL,
       started_at ${integer} NOT NULL,
       updated_at ${integer} NOT NULL
     )`);
}

/** Opens a new journal entry at `PREPARED_SNAPSHOT` and returns its id. Checkpointed before returning. */
export async function beginJournalEntry(
  required: { db: PluginStore; pluginId: string; snapshotPath: string },
  _optional: Record<string, never> = {}
): Promise<number> {
  const { pluginId, snapshotPath } = required;
  const kernel = pluginKernel({ store: required.db });
  const now = Date.now();
  const row = await kernel.run((db) =>
    db
      .insertInto("_plugin_migration_journal")
      .values({ plugin_id: pluginId, phase: "PREPARED_SNAPSHOT", snapshot_path: snapshotPath, started_at: now, updated_at: now })
      .returning("id")
      .executeTakeFirstOrThrow()
  );
  await checkpointWal(kernel);
  return Number(row.id);
}

/**
 * Writes a phase transition WITHOUT checkpointing (BUG FIX, 2026-08-12 — see `data-module.ts`'s
 * header comment, POST-COMMIT DATA-LOSS WINDOW). Exists solely for a caller that needs to write a
 * phase transition from INSIDE an already-open kernel transaction, where `advanceJournalPhase`'s
 * checkpoint cannot run: a SQLite WAL checkpoint issued by the SAME connection that holds an open
 * write transaction throws `database table is locked` (confirmed directly against this repo's
 * better-sqlite3 build, not assumed from SQLite's docs, which don't call out same-connection
 * mid-transaction checkpoint behavior at all). The caller is responsible for checkpointing the SAME
 * id once its own transaction has committed — typically by calling `advanceJournalPhase` again for
 * the same id/phase, which re-writes the (already correct) row and performs the deferred checkpoint
 * in one call. Skipping that follow-up checkpoint does not weaken crash-durability: the phase
 * transition is already durable the instant the caller's transaction commits (a normal SQLite WAL
 * commit), the same as any other write in that transaction — the checkpoint only controls when the
 * WAL is merged back into the main db file, not whether the write survives a crash.
 */
export async function stageJournalPhase(
  required: { db: PluginStore; id: number; phase: JournalPhase },
  _optional: Record<string, never> = {}
): Promise<void> {
  const { id, phase } = required;
  await pluginKernel({ store: required.db }).run((db) =>
    db.updateTable("_plugin_migration_journal").set({ phase, updated_at: Date.now() }).where("id", "=", id).execute()
  );
}

/** Advances a journal entry to `phase`, checkpointed before returning (durable before the next step runs). */
export async function advanceJournalPhase(
  required: { db: PluginStore; id: number; phase: JournalPhase },
  _optional: Record<string, never> = {}
): Promise<void> {
  const kernel = pluginKernel({ store: required.db });
  await stageJournalPhase({ db: kernel, id: required.id, phase: required.phase });
  await checkpointWal(kernel);
}

/** Boot-time recovery scan (§2): any entry NOT in a terminal phase is a crash-interrupted attempt. */
export async function findIncompleteJournalEntries(
  { store }: { store: PluginStore },
  _optional: Record<string, never> = {}
): Promise<JournalEntry[]> {
  const kernel: PluginKernel = pluginKernel({ store });
  const rows = await kernel.run((db) =>
    db.selectFrom("_plugin_migration_journal").select(["id", "plugin_id", "phase", "snapshot_path", "started_at", "updated_at"]).orderBy("id").execute()
  );
  return rows.filter((r) => isIncompletePhase({ phase: r.phase })).map((row) => journalEntryOf({ row }));
}

/** One `_plugin_migration_journal` row as a {@link JournalEntry} (numbers normalized across drivers). */
export function journalEntryOf({ row }: { row: {
  id: number;
  plugin_id: string;
  phase: string;
  snapshot_path: string;
  started_at: number;
  updated_at: number;
} }, _optional: Record<string, never> = {}): JournalEntry {
  return {
    id: Number(row.id),
    pluginId: row.plugin_id,
    phase: row.phase as JournalPhase,
    snapshotPath: row.snapshot_path,
    startedAt: Number(row.started_at),
    updatedAt: Number(row.updated_at),
  };
}
