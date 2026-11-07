/**
 * @file SPIKE — whole-file snapshot before a schema change (ADR-023 §4, §11).
 *
 * The never-brick reversibility anchor: core takes a whole-file snapshot via SQLite's ONLINE
 * BACKUP API (not a raw `fs` copy — the backup API is WAL-safe on a live db) before ANY plugin
 * DDL. If the change fails, the snapshot is the named recovery point (§9). Copy-on-write
 * shadow-tables are a deferred >~1GB optimization (§11), not this.
 *
 * BUG FIX (2026-07-28): for an in-memory (or SQLite's other non-file) `dbPath`, this function is a
 * no-op that returns `null` instead of attempting a file backup. This is NOT a weakened guarantee —
 * it's recognizing the guarantee doesn't apply. §4's whole doctrine is "next-boot recovery from a
 * crash" (see `data-module.ts`'s file header and `migration-recovery.ts`): for `:memory:`, there is
 * no "next boot" — the database is discarded in full the instant the process ends, whether or not a
 * snapshot exists. Before this fix, `path.dirname(":memory:")` resolved to `"."` (the process's
 * current working directory) and `path.basename(":memory:")` resolved to the literal string
 * `":memory:"`, so every call against an in-memory test db (used pervasively by this repo's test
 * suite, e.g. `src/newsletter/__tests__/repo.contract.test.ts` via `openContentDb(":memory:")`)
 * wrote a REAL, non-empty SQLite backup file literally named `:memory:.snapshot-<label>-<ts>` into
 * the repo root — hundreds of MB accumulated across a single session's test runs.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { type PluginStore, pluginKernel } from "./plugin-store.js";

/**
 * True when `dbPath` is one of SQLite's special non-file identifiers rather than a real path on
 * disk, for any of which `path.dirname`/`path.basename` produce meaningless fragments:
 *  - the literal `:memory:` identifier (an anonymous, process-private in-memory database);
 *  - the empty string `""` (SQLite's OTHER special identifier — an anonymous, private on-disk temp
 *    database deleted when the connection closes; like `:memory:` it never has a stable path to
 *    snapshot to or restore from, so it gets the same no-op treatment);
 *  - a `file:` URI naming the same thing via SQLite's URI-filename syntax — either the path
 *    component is itself the `:memory:` token (e.g. `file::memory:?cache=shared`, the form SQLite's
 *    own docs use) or the query string sets `mode=memory` explicitly (e.g. `file:x?mode=memory`).
 * See sqlite.org/inmemorydb.html and sqlite.org/uri.html.
 */
export function isInMemoryDbPath(
  { dbPath }: { dbPath: string },
  _optional: Record<string, never> = {}
): boolean {
  if (dbPath === ":memory:" || dbPath === "") return true;
  if (!dbPath.startsWith("file:")) return false;

  const withoutScheme = dbPath.slice("file:".length);
  const queryIndex = withoutScheme.indexOf("?");
  const pathPart = queryIndex === -1 ? withoutScheme : withoutScheme.slice(0, queryIndex);
  if (pathPart === ":memory:") return true;

  const queryPart = queryIndex === -1 ? "" : withoutScheme.slice(queryIndex + 1);
  return new URLSearchParams(queryPart).get("mode") === "memory";
}

/**
 * Snapshot `db` (the SQLite database file at `dbPath`) to a sibling file and return its path — or
 * `null` for an in-memory `dbPath` (see `isInMemoryDbPath` and this file's header), for which no
 * snapshot is taken because no real file backs the database at all. The copy is the kernel's
 * `backupTo`: on SQLite, the online backup API, a consistent whole-file copy of a live WAL db.
 * Call it outside a transaction.
 */
export async function snapshotDb(
  required: { db: PluginStore; dbPath: string; label: string },
  _optional: Record<string, never> = {}
): Promise<string | null> {
  const { db, dbPath, label } = required;
  if (isInMemoryDbPath({ dbPath })) return null;

  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath);
  const snapshotPath = path.join(dir, `${base}.snapshot-${label}-${Date.now()}`);
  await pluginKernel({ store: db }).backupTo(snapshotPath);
  return snapshotPath;
}

/**
 * Delete a snapshot whose recovery window has closed. Best-effort and never throws: this runs
 * AFTER the migration it guarded is already committed, so a failure to unlink is untidy, not
 * unsafe, and must not turn a successful migration into a reported failure.
 *
 * ADR-023 §4 amendment (2026-08-02). §4 specified taking the snapshot but never said when one
 * stops being needed, so nothing ever deleted them: every plugin that declared tables left a
 * whole-database copy on disk permanently, three at a time for a stock install (`store`,
 * `newsletter`, `comments`), each the full size of `content.db`.
 *
 * The retention rule that replaces "forever" is not a heuristic or a count — it falls out of who
 * reads these files. The only consumer is `migration-recovery.ts`, which acts exclusively on
 * journal entries in a NON-terminal phase (see `findIncompleteJournalEntries`). The instant an
 * entry reaches `COMMITTED`, its snapshot is unreachable by every code path that exists. Deleting
 * it there removes zero recovery capability: the never-brick guarantee covers the window between
 * "snapshot taken" and "DDL committed", and that window has closed.
 *
 * **A failed migration keeps its snapshot**, deliberately — the catch path leaves the entry
 * non-terminal precisely so the next boot can restore from it, and §9 also wants it retained for
 * operator forensics.
 *
 * `_plugin_migrations.snapshot_path` still records which snapshot guarded each committed DDL. That
 * row is history — it says what protected the change at the time, which stays true — so a path
 * pointing at a since-deleted file is expected, not a dangling reference to repair.
 */
export async function discardCommittedSnapshot(
  { snapshotPath }: { snapshotPath: string },
  _optional: Record<string, never> = {}
): Promise<void> {
  await fs.rm(snapshotPath, { force: true }).catch(() => {});
}
