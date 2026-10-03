/** Local app.sqlite singleton policy; the host explicitly supplies its SQLite driver. */
import path from 'node:path';
import fs from 'node:fs';
import { openSqliteConnection, type SqliteDb, type SqliteSyncOpener } from '@jini-ai/db/sqlite';
import { LEGACY_CHAT_DDL } from '@jini-ai/chat/store/legacy/sqlite';
import { LEGACY_AGENT_SESSIONS_DDL } from '@jini-ai/daemon/store/agent-sessions/sqlite';
import { LEGACY_PROJECTS_DDL } from '../../store/projects/sqlite.js';
let dbInstance: SqliteDb | null = null;
let dbFile: string | null = null;

/**
 * Explicit idempotent bootstrap of unchanged legacy tables; no versioned migration ledger.
 * @param db Borrowed host handle; this operation neither opens nor closes it.
 * @complexity O(1) schema statements.
 */
// Only generic engine tables belong in this bootstrap; consumer feature tables and migrations
// stay in host adapters. Every legacy column is declared in the base DDL, so this is not an
// ALTER TABLE migration path for a consumer's pre-existing product schema.
// Catalog tables are created only by hosts that actually seed and query them. A parallel execution
// table would also weaken the existing ToolExecutionAuditRecord (principal, run and phase data);
// durable audit storage should preserve that record rather than introduce a second audit noun.
export function migrate({ db }: { db: SqliteDb }): void {
 db.exec(LEGACY_PROJECTS_DDL + LEGACY_CHAT_DDL + LEGACY_AGENT_SESSIONS_DDL);
}

/**
 * Opens/caches <dataDir>/app.sqlite using the injected opener, WAL and foreign keys.
 * A new path closes the previous singleton; setup failure closes only the newly acquired handle.
 * @throws The original host acquisition/schema failure, or a missing opener.
 * @complexity O(1) acquisition/bootstrap calls, independent of stored row count.
 */
export function openDatabase(
 { projectRoot, open }: { projectRoot: string; open: SqliteSyncOpener },
 options: { dataDir?: string; filesystem?: Pick<typeof fs, 'mkdirSync'> } = {},
): SqliteDb {
 // Keep the historical refusal text for JavaScript callers that omit the required port.
 if (!open) throw new Error('openDatabase: inject options.open');
 const dir = options.dataDir ? path.resolve(options.dataDir) : path.join(projectRoot, '.jini');
 const file = path.join(dir, 'app.sqlite');
 if (dbInstance && dbFile === file) return dbInstance;
 closeDatabase();
 (options.filesystem ?? fs).mkdirSync(dir, { recursive: true });
 let db: SqliteDb | undefined;
 try {
  db = openSqliteConnection({filePath:file, open(file,settings) { db=open(file,settings);return db; }, pragmas:['journal_mode = WAL','foreign_keys = ON']});
  migrate({ db });dbInstance=db;dbFile=file;return db;
 } catch(error) {
  try {db?.close();} catch { /* Keep the original bootstrap failure. */ }
  throw error;
 }
}
/** Close the active owned singleton once; clearing state first permits a clean retry after failure. */
export function closeDatabase():void {
 const db=dbInstance;dbInstance=null;dbFile=null;db?.close();
}
