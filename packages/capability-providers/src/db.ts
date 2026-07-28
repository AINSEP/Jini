/**
 * `DbProvider` — a swappable, minimal document-store port (collection +
 * record id, not a query language). Speculative port-design exploration
 * (see `source-map.md`) — no OD source; the capability
 * `foundry/docs/jini-port/recon/r5b-consumers-matrix.md` §3.3 names as the one Zana
 * (Supabase→db+auth+storage+realtime) and Tovu-Runner (ports+sqlite/memory)
 * both built explicitly.
 *
 * This file defines the port's stable interface/type surface, plus one real,
 * production-quality adapter (`SqliteDbProvider`, added 2026-07-21 — see
 * `source-map.md`'s dated section) backed directly by `better-sqlite3` — the
 * same driver `@injini/sqlite`'s `createSqliteEventLog` uses, following that
 * module's DI/schema conventions (an injected, already-open `Database`
 * handle; idempotent `CREATE TABLE IF NOT EXISTS`; multi-statement writes
 * wrapped in `db.transaction()`). The in-memory reference implementation
 * (`createInMemoryDbProvider`) is a separate, non-production stub that lives
 * under `src/unsafe-reference/`, exported only from the separate
 * `@injini/capability-providers/unsafe-reference` entry point — see that
 * directory's `index.ts` header for the full warning.
 */
import type Database from 'better-sqlite3';

export interface DbRecord {
  readonly id: string;
  readonly [field: string]: unknown;
}

export interface DbQuery {
  /** Exact-match filter: every key/value pair must match on a candidate record. Omitted/empty means "all records". */
  readonly where?: Readonly<Record<string, unknown>>;
}

export interface DbProvider {
  /** Inserts a record into `collection`. Rejects if `record.id` already exists in that collection. */
  insert(collection: string, record: DbRecord): Promise<DbRecord>;
  /** Looks up a record by id, or `null` if unknown. */
  get(collection: string, id: string): Promise<DbRecord | null>;
  /** Shallow-merges `patch` into an existing record. Returns `null` if `id` is unknown (no upsert). */
  update(collection: string, id: string, patch: Readonly<Record<string, unknown>>): Promise<DbRecord | null>;
  /** Deletes a record by id. A no-op if it doesn't exist. */
  delete(collection: string, id: string): Promise<void>;
  /** Returns every record in `collection` matching `query.where` (all records when `query` is omitted). */
  query(collection: string, query?: DbQuery): Promise<DbRecord[]>;
}

/** Alias for a `better-sqlite3` `Database` handle, matching `@injini/sqlite`'s own `SqliteDb` alias (`packages/sqlite/src/db/core/types.ts`). */
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
