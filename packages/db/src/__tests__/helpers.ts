import { PGlite } from "@electric-sql/pglite";
import Database from "better-sqlite3";

import type { SqliteOpener } from "../sqlite/index.js";

/**
 * @file What the tests pass where a consumer passes its own: the better-sqlite3 opener, and the
 * names this package refuses to default (owner lock file, socket run dir, migration ledger).
 */

export const openSqlite: SqliteOpener = (filePath, options) => new Database(filePath, options);
export const LOCK_FILE = "app-owner.pid";
export const RUN_DIR = "jinidb";
export const LEDGER = "app_migrations";

/** The consumer-supplied parts of `startPgliteOwner`'s required input. */
export const OWNER = { PGlite, lockFileName: LOCK_FILE, runDirName: RUN_DIR } as const;
