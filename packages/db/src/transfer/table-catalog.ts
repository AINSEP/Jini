import type { SourceColumn, SourceTableLayout, TransferSource } from "./sqlite-source.js";
import type { TransferColumn, TransferTable } from "./types.js";

/** SQLite type affinity (https://sqlite.org/datatype3.html §3.1), mapped onto a Postgres type. */
function postgresTypeFor(declaredType: string): string {
  const type = declaredType.toUpperCase();
  if (type.includes("INT")) return "bigint";
  if (/CHAR|CLOB|TEXT/.test(type)) return "text";
  if (type.includes("BLOB")) return "bytea";
  if (/REAL|FLOA|DOUB/.test(type)) return "double precision";
  return "text";
}

/** Only plain literals travel: a number, or a single-quoted string. Anything else (a function call) is dropped. */
function literalDefault(defaultSql: string | null, sqlType: string): string | undefined {
  if (defaultSql === null || sqlType === "bytea") return undefined;
  const text = defaultSql.trim();
  if (/^-?\d+(\.\d+)?$/.test(text) || /^'(?:[^']|'')*'$/.test(text)) return text;
  return undefined;
}

function introspectedColumn(column: SourceColumn, rowId: boolean): TransferColumn {
  const sqlType = postgresTypeFor(column.declaredType);
  const fallback = literalDefault(column.defaultSql, sqlType);
  return {
    name: column.name,
    sqlType,
    notNull: column.notNull || column.primaryKeyPosition > 0,
    ...(fallback === undefined ? {} : { default: fallback }),
    ...(rowId ? { identity: "BY DEFAULT" as const } : {}),
  };
}

/** A table no host schema file describes, in the layout the snapshot declares. */
export function introspectedTable({ name, layout }: { name: string; layout: SourceTableLayout }, _optional = {}): TransferTable {
  const primaryKey = layout.columns.filter((column) => column.primaryKeyPosition > 0).sort((a, b) => a.primaryKeyPosition - b.primaryKeyPosition).map((column) => column.name);
  const rowIdColumn = primaryKey.length === 1 ? layout.columns.find((column) => column.name === primaryKey[0] && column.declaredType.toUpperCase() === "INTEGER") : undefined;
  const indexes = layout.indexes
    .filter((index) => index.origin !== "pk" && !index.partial && index.columns.every((column) => column !== null))
    .map((index) => {
      const columns = index.columns as string[];
      return { name: index.origin === "u" ? `${name}_${columns.join("_")}_key` : index.name, columns, unique: index.unique };
    });
  return {
    name,
    columns: layout.columns.map((column) => introspectedColumn(column, column === rowIdColumn)),
    primaryKey,
    indexes,
    foreignKeys: layout.foreignKeys.map((fk) => ({
      name: `${name}_${fk.columns.join("_")}_fkey`,
      columns: fk.columns,
      foreignTable: fk.foreignTable,
      foreignColumns: fk.foreignColumns.some((column) => column === null) ? null : (fk.foreignColumns as string[]),
      onDelete: fk.onDelete.toLowerCase(),
      onUpdate: fk.onUpdate.toLowerCase(),
    })),
    checks: [],
  };
}

export const LEFT_OUT_REASON = {
  bookkeeping: "the database's own bookkeeping is not copied",
  derived: "search indexes are rebuilt from the content, not copied",
  secret: "tables holding passwords, keys or sign-in tokens are not copied",
} as const;

export interface SnapshotTablePlan {
  /** Core tables first (foreign-key-safe order), then the snapshot's other tables by name. */
  readonly tables: readonly TransferTable[];
  readonly leftOut: readonly { readonly table: string; readonly reason: string }[];
}

/**
 * The migration ledgers (supplied by the host) stay behind: the
 * target is built to head by its own runner, and a copied SQLite ledger would tell it steps had run there.
 */
export interface SnapshotTablePolicy {
  readonly coreTables: readonly TransferTable[];
  readonly coreNames: ReadonlySet<string>;
  readonly excludedTables: Readonly<Record<string, string>>;
  readonly derivedNames: ReadonlySet<string>;
  readonly migrationLedgers: ReadonlySet<string>;
  readonly bookkeepingPrefixes: readonly string[];
  readonly secretColumnPattern: RegExp;
}

function isBookkeeping(name: string, policy: SnapshotTablePolicy): boolean {
  return policy.migrationLedgers.has(name) || policy.bookkeepingPrefixes.some(prefix => name.startsWith(prefix));
}

/** The reason a non-core table stays behind, or `null` when it is copied. */
function reasonToLeaveOut(name: string, layout: SourceTableLayout, derived: ReadonlySet<string>, virtualTables: readonly string[], policy: SnapshotTablePolicy): string | null {
  if (isBookkeeping(name, policy)) return LEFT_OUT_REASON.bookkeeping;
  if (derived.has(name) || layout.virtual || virtualTables.some((vt) => name.startsWith(`${vt}_`))) return LEFT_OUT_REASON.derived;
  if (layout.columns.some((column) => new RegExp(policy.secretColumnPattern.source, policy.secretColumnPattern.flags.replace(/[gy]/g, "")).test(column.name))) return LEFT_OUT_REASON.secret;
  return null;
}

/**
 * Sorts every table in the snapshot into copied or left out (with the reason). Core tables come from
 * the injected host catalog even when the snapshot lacks them, so {@link countSourceRows} can name the gap.
 *
 * @complexity O(snapshot tables) PRAGMA reads.
 */
export function planSnapshotTables({ source, policy }: { source: TransferSource; policy: SnapshotTablePolicy }, _optional = {}): SnapshotTablePlan {
  const core = policy.coreNames;
  const tables: TransferTable[] = [...policy.coreTables];
  const leftOut: { table: string; reason: string }[] = [];
  const derived = policy.derivedNames;
  const names = source.tableNames();
  const layouts = new Map(names.map((name) => [name, source.layout(name)] as const));
  const virtualTables = names.filter((name) => layouts.get(name)?.virtual === true);
  for (const name of names) {
    const excluded = policy.excludedTables[name];
    if (excluded !== undefined) {
      leftOut.push({ table: name, reason: excluded });
      continue;
    }
    const layout = layouts.get(name);
    if (core.has(name) || layout === null || layout === undefined) continue;
    const reason = reasonToLeaveOut(name, layout, derived, virtualTables, policy);
    if (reason === null) tables.push(introspectedTable({ name, layout }));
    else leftOut.push({ table: name, reason });
  }
  return { tables, leftOut };
}
