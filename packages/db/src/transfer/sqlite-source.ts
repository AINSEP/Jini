/** Structural snapshot client: the consumer chooses and owns its driver installation. */
export interface SnapshotStatement {
  all(...args: unknown[]): unknown[];
  get(...args: unknown[]): unknown;
  raw(): SnapshotStatement;
  safeIntegers(): SnapshotStatement;
  iterate(): Iterable<unknown[]>;
}
export interface SnapshotClient { prepare(sql: string): SnapshotStatement; close(): void; }
export type SnapshotOpener = (bytes: Buffer, options: { readonly: true }) => SnapshotClient;

/**
 * @file The SQLite side of a database transfer: a snapshot held as bytes (from
 * `DbOpsPort.captureRestorePoint`, never the live file), opened in memory, read only. The copier sees
 * only {@link TransferSource}, so a Postgres source for the later "switch back" is a second adapter,
 * not a copier change.
 */

/** One column as the source declares it (SQLite `PRAGMA table_info`). */
export interface SourceColumn {
  readonly name: string;
  /** The declared type, as written (`INTEGER`, `TEXT`, `` for none). */
  readonly declaredType: string;
  readonly notNull: boolean;
  /** The default as SQL text, as written, or `null`. */
  readonly defaultSql: string | null;
  /** 1-based position in the primary key; 0 when not part of it. */
  readonly primaryKeyPosition: number;
}

export interface SourceForeignKey {
  readonly columns: readonly string[];
  readonly foreignTable: string;
  /** `null` entries mean "the parent's primary key" (SQLite lets a foreign key omit its columns). */
  readonly foreignColumns: readonly (string | null)[];
  readonly onDelete: string;
  readonly onUpdate: string;
}

export interface SourceIndex {
  readonly name: string;
  readonly unique: boolean;
  /** `c` CREATE INDEX, `u` a UNIQUE constraint, `pk` the primary key. */
  readonly origin: string;
  readonly partial: boolean;
  /** `null` for an expression column. */
  readonly columns: readonly (string | null)[];
}

/** A table's layout as the source declares it, for tables no host schema file describes (plugins). */
export interface SourceTableLayout {
  /** A virtual table (FTS and the like): its rows are derived, never copied. */
  readonly virtual: boolean;
  readonly columns: readonly SourceColumn[];
  readonly foreignKeys: readonly SourceForeignKey[];
  readonly indexes: readonly SourceIndex[];
}

export interface TransferSource {
  /** Every table in the source, virtual and internal ones included, by name. */
  tableNames(): readonly string[];
  /** The table's declared layout, or `null` when the source has no such table. */
  layout(table: string): SourceTableLayout | null;
  /** The table's column names, or `null` when the source has no such table. */
  columns(table: string): readonly string[] | null;
  /** `keep`, when given, is a predicate in the source's own SQL selecting the rows that count. */
  countRows(table: string, keep?: string): number;
  /** Every row (or every row matching `keep`), cells in `columns` order; integers as `bigint`, so no
   *  64-bit value loses precision. */
  rows(table: string, columns: readonly string[], keep?: string): Iterable<unknown[]>;
  close(): void;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** `keep` comes only from trusted host exclusion policy, never from tool input. */
function where(keep: string | undefined): string {
  return keep === undefined ? "" : ` WHERE ${keep}`;
}

/**
 * A site database runs in WAL mode, and its snapshot's header says so (bytes 18-19 = 2). SQLite
 * cannot open WAL-mode bytes in memory ("unable to open database file"), so a copy of the bytes is
 * marked rollback-journal (1) first. The pages themselves are complete: a backup never needs the WAL.
 */
function inMemoryReadableBytes(bytes: Buffer): Buffer {
  if (bytes[18] !== 2 && bytes[19] !== 2) return bytes;
  const copy = Buffer.from(bytes);
  copy[18] = 1;
  copy[19] = 1;
  return copy;
}

interface PragmaColumn { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }
interface PragmaForeignKey { id: number; table: string; from: string; to: string | null; on_update: string; on_delete: string }
interface PragmaIndex { name: string; unique: number; origin: string; partial: number }

function foreignKeysOf(db: SnapshotClient, table: string): SourceForeignKey[] {
  const rows = db.prepare(`PRAGMA foreign_key_list(${quoteIdent(table)})`).all() as PragmaForeignKey[];
  const byId = new Map<number, PragmaForeignKey[]>();
  for (const row of rows) byId.set(row.id, [...(byId.get(row.id) ?? []), row]);
  return [...byId.values()].map((parts) => ({
    columns: parts.map((part) => part.from),
    foreignTable: parts[0]!.table,
    foreignColumns: parts.map((part) => part.to),
    onDelete: parts[0]!.on_delete,
    onUpdate: parts[0]!.on_update,
  }));
}

function indexesOf(db: SnapshotClient, table: string): SourceIndex[] {
  const list = db.prepare(`PRAGMA index_list(${quoteIdent(table)})`).all() as PragmaIndex[];
  return list.map((index) => ({
    name: index.name,
    unique: index.unique === 1,
    origin: index.origin,
    partial: index.partial === 1,
    columns: (db.prepare(`PRAGMA index_info(${quoteIdent(index.name)})`).all() as { name: string | null }[]).map((column) => column.name),
  }));
}

function layoutOf(db: SnapshotClient, table: string): SourceTableLayout | null {
  const master = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string | null } | undefined;
  if (master === undefined) return null;
  const columns = (db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as PragmaColumn[]).map((column) => ({
    name: column.name,
    declaredType: column.type,
    notNull: column.notnull === 1,
    defaultSql: column.dflt_value,
    primaryKeyPosition: column.pk,
  }));
  const virtual = /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(master.sql ?? "");
  return { virtual, columns, foreignKeys: virtual ? [] : foreignKeysOf(db, table), indexes: virtual ? [] : indexesOf(db, table) };
}

/** @complexity O(database size) to deserialize the snapshot. */
export function openSqliteSnapshotSource({ bytes }: { bytes: Buffer }, { open }: { open: SnapshotOpener }): TransferSource {
  const db = open(inMemoryReadableBytes(bytes), { readonly: true });
  return {
    tableNames() {
      return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
    },
    layout: (table) => layoutOf(db, table),
    columns(table) {
      const info = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as { name: string }[];
      return info.length === 0 ? null : info.map((column) => column.name);
    },
    countRows(table, keep) {
      return (db.prepare(`SELECT count(*) AS n FROM ${quoteIdent(table)}${where(keep)}`).get() as { n: number }).n;
    },
    rows(table, columns, keep) {
      return db.prepare(`SELECT ${columns.map(quoteIdent).join(", ")} FROM ${quoteIdent(table)}${where(keep)}`).raw().safeIntegers().iterate() as Iterable<unknown[]>;
    },
    close: () => db.close(),
  };
}
