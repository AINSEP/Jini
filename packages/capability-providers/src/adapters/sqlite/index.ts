/**
 * `@jini-ai/capability-providers/adapters/sqlite` — the one real,
 * production-quality `DbProvider` adapter this package ships, backed directly
 * by `better-sqlite3`, following `@jini-ai/sqlite`'s `createSqliteEventLog`
 * DI/schema conventions (an injected, already-open `Database` handle;
 * idempotent `CREATE TABLE IF NOT EXISTS`; multi-statement writes wrapped in
 * `db.transaction()`).
 *
 * Lives at this separate entry point (not the package's main
 * `@jini-ai/capability-providers` barrel) so importing the port
 * interface/types/DI tokens never forces a consumer to resolve
 * `better-sqlite3` — including in its emitted `.d.ts`, where the
 * `Database.Database` type reference would otherwise make the main barrel
 * unresolvable for a TypeScript consumer who never installed the optional
 * peer. Import from here only when you actually want this concrete adapter.
 *
 * The in-memory reference implementation (`createInMemoryDbProvider`) is a
 * separate, non-production stub under `src/unsafe-reference/` — see that
 * directory's `index.ts` header for the full warning.
 */
import type Database from 'better-sqlite3';
import type { DbProvider, DbQuery, DbRecord } from '../../db.js';

/** Alias for a `better-sqlite3` `Database` handle, matching `@jini-ai/sqlite`'s own `SqliteDb` alias (`packages/sqlite/src/db/core/types.ts`). */
type SqliteDatabase = Database.Database;

interface DbRecordRow {
  readonly collection: string;
  readonly id: string;
  readonly data: string;
}

/** Exact-match filter used by both `query()` here and the in-memory reference adapter's own `matchesWhere` — kept as an independent, self-contained copy rather than a shared import so this adapter has no dependency on `src/unsafe-reference/`. */
function matchesWhere(record: DbRecord, where: Readonly<Record<string, unknown>> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => record[key] === value);
}

/**
 * `DbProvider` adapter backed by an injected, already-open `better-sqlite3` `Database` handle.
 * Every collection's records live in one physical table (`collection`, `id`, JSON-serialized
 * `data`), primary-keyed on `(collection, id)`; `query()`'s exact-match `where` filter is applied
 * client-side over every row in the collection after a plain `SELECT ... WHERE collection = ?` —
 * deliberately not compiled to SQL predicates, matching `DbQuery`'s own "not a query language"
 * framing and the in-memory reference adapter's identical semantics, so behavior is identical
 * between the two adapters for every input.
 *
 * Callers own the `Database` handle's lifecycle (open/close, WAL mode, file path or `:memory:`)
 * — this class only creates its own table on construction (`CREATE TABLE IF NOT EXISTS`, safe to
 * re-run against an already-migrated handle) and never opens or closes a connection itself,
 * mirroring `createSqliteEventLog`'s "pass `':memory:'` for a non-durable in-process database"
 * convention for tests.
 */
export class SqliteDbProvider implements DbProvider {
  private readonly getStmt: Database.Statement<[string, string], DbRecordRow>;
  private readonly insertStmt: Database.Statement<[string, string, string]>;
  private readonly updateStmt: Database.Statement<[string, string, string]>;
  private readonly deleteStmt: Database.Statement<[string, string]>;
  private readonly queryStmt: Database.Statement<[string], DbRecordRow>;
  private readonly insertTxn: (collection: string, record: DbRecord) => DbRecord;
  private readonly updateTxn: (
    collection: string,
    id: string,
    patch: Readonly<Record<string, unknown>>,
  ) => DbRecord | null;

  constructor(db: SqliteDatabase) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS jini_capability_db_records (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );
    `);

    this.getStmt = db.prepare<[string, string], DbRecordRow>(
      'SELECT collection, id, data FROM jini_capability_db_records WHERE collection = ? AND id = ?',
    );
    this.insertStmt = db.prepare<[string, string, string]>(
      'INSERT INTO jini_capability_db_records (collection, id, data) VALUES (?, ?, ?)',
    );
    this.updateStmt = db.prepare<[string, string, string]>(
      'UPDATE jini_capability_db_records SET data = ? WHERE collection = ? AND id = ?',
    );
    this.deleteStmt = db.prepare<[string, string]>(
      'DELETE FROM jini_capability_db_records WHERE collection = ? AND id = ?',
    );
    this.queryStmt = db.prepare<[string], DbRecordRow>(
      'SELECT collection, id, data FROM jini_capability_db_records WHERE collection = ?',
    );

    // Wrapped in db.transaction() for the same reason createSqliteEventLog wraps its
    // dedupe-check + insert: a single atomic unit of work at the SQL level, not a JS-level race
    // guard (better-sqlite3 is synchronous, so no other JS can run between the get() and run()
    // calls within one process either way).
    this.insertTxn = db.transaction((collection: string, record: DbRecord): DbRecord => {
      const existing = this.getStmt.get(collection, record.id);
      if (existing) {
        throw new Error(`record already exists: ${collection}/${record.id}`);
      }
      this.insertStmt.run(collection, record.id, JSON.stringify(record));
      return record;
    });

    this.updateTxn = db.transaction(
      (collection: string, id: string, patch: Readonly<Record<string, unknown>>): DbRecord | null => {
        const row = this.getStmt.get(collection, id);
        if (!row) return null;
        const updated: DbRecord = { ...(JSON.parse(row.data) as DbRecord), ...patch, id };
        this.updateStmt.run(JSON.stringify(updated), collection, id);
        return updated;
      },
    );
  }

  async insert(collection: string, record: DbRecord): Promise<DbRecord> {
    return this.insertTxn(collection, record);
  }

  async get(collection: string, id: string): Promise<DbRecord | null> {
    const row = this.getStmt.get(collection, id);
    return row ? (JSON.parse(row.data) as DbRecord) : null;
  }

  async update(collection: string, id: string, patch: Readonly<Record<string, unknown>>): Promise<DbRecord | null> {
    return this.updateTxn(collection, id, patch);
  }

  async delete(collection: string, id: string): Promise<void> {
    this.deleteStmt.run(collection, id);
  }

  async query(collection: string, query: DbQuery = {}): Promise<DbRecord[]> {
    const rows = this.queryStmt.all(collection);
    return rows.map((row) => JSON.parse(row.data) as DbRecord).filter((record) => matchesWhere(record, query.where));
  }
}
