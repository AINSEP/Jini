import { quoteIdent } from "./postgres-ddl.js";
import { planSnapshotTables, type SnapshotTablePlan } from "./table-catalog.js";
import type { TransferSource } from "./sqlite-source.js";
import type { TransferColumn, TransferIndex, TransferTable } from "./types.js";

/**
 * @file The generic half of "what a copy carries" for a host schema declared in some ORM: the host
 * injects a structural {@link CatalogIntrospection} (so this package imports no ORM), its exclusion
 * tables and its naming; this module projects the schema into {@link TransferTable}s and plans the snapshot.
 */

/** One index term: a plain column (the name can be missing in a malformed declaration) or a raw SQL expression. */
export type CatalogIndexTerm = { readonly kind: "column"; readonly name: string | undefined } | { readonly kind: "sql"; readonly sql: unknown };

export interface CatalogColumnConfig {
  readonly name: string;
  readonly sqlType: string;
  readonly notNull: boolean;
  /** Inline (single-column) primary key. */
  readonly primary: boolean;
  readonly isUnique: boolean;
  readonly uniqueName?: string;
  readonly hasDefault: boolean;
  /** The declared default: an ORM SQL value, a string, a number or a boolean. */
  readonly default?: unknown;
  readonly identity?: "always" | "byDefault";
}

export interface CatalogIndexConfig {
  readonly name?: string;
  readonly terms: readonly CatalogIndexTerm[];
  readonly unique: boolean;
  /** Partial-index predicate as an ORM SQL value. */
  readonly where?: unknown;
}

export interface CatalogForeignKeyConfig {
  readonly name: string;
  readonly columns: readonly string[];
  readonly foreignTable: string;
  readonly foreignColumns: readonly string[];
  readonly onDelete?: string;
  readonly onUpdate?: string;
}

export interface CatalogTableConfig {
  readonly name: string;
  readonly columns: readonly CatalogColumnConfig[];
  readonly indexes: readonly CatalogIndexConfig[];
  readonly uniqueConstraints: readonly { readonly name?: string; readonly columns: readonly string[] }[];
  /** Composite primary keys, one entry per declared key. */
  readonly primaryKeys: readonly { readonly columns: readonly string[] }[];
  /** Resolved when the table is read, never earlier: foreign keys may reference tables declared later. */
  readonly foreignKeys: () => readonly CatalogForeignKeyConfig[];
  readonly checks: readonly { readonly name: string; readonly value: unknown }[];
}

/** Everything this module needs to read from the host's ORM; the host builds it from its own library. */
export interface CatalogIntrospection {
  /** The SQL table name, without resolving the table's foreign keys. */
  tableName(table: unknown): string;
  tableConfig(table: unknown): CatalogTableConfig;
  /** True for a value the ORM declares as a table. */
  isTable(value: unknown): boolean;
  /** True for an ORM raw-SQL value (a default expression, for example). */
  isSql(value: unknown): boolean;
  /** Render an ORM SQL value as Postgres SQL. `indexTerm` renders an expression with parameters inlined and table qualifiers omitted. */
  renderSql(args: { value: unknown; indexTerm?: boolean }): string;
}

export interface CatalogSchemaPorts {
  readonly introspection: CatalogIntrospection;
  /** The host schema's exports by name; `undefined` marks an export that is missing. */
  readonly schema: Readonly<Record<string, unknown>>;
  readonly copyOrder: () => readonly string[];
  readonly derivedNames: ReadonlySet<string>;
  /** Label naming the host schema file in error messages. */
  readonly schemaLabel: string;
  /** Tables carried whole-minus-rows: only the rows matching the source-side `keep` predicate are copied. */
  readonly partiallyExcluded: Readonly<Record<string, { readonly keep: string } | undefined>>;
  /** Tables left out entirely, keyed by table name, valued by the disclosed reason. */
  readonly excludedTables: Readonly<Record<string, string>>;
}

function quoteLiteral({ value }: { value: string }, _options = {}): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function coreDefault({ column, introspection, schemaLabel }: { column: CatalogColumnConfig; introspection: CatalogIntrospection; schemaLabel: string }, _optional = {}): string | undefined {
  if (!column.hasDefault || column.default === undefined) return undefined;
  const value: unknown = column.default;
  if (introspection.isSql(value)) return introspection.renderSql({ value });
  if (typeof value === "string") return quoteLiteral({ value });
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new Error(`${schemaLabel}: '${column.name}' has a default this copier cannot write`);
}

function coreColumn({ column, introspection, schemaLabel }: { column: CatalogColumnConfig; introspection: CatalogIntrospection; schemaLabel: string }, _optional = {}): TransferColumn {
  const base = { name: column.name, sqlType: column.sqlType, notNull: column.notNull };
  const fallback = coreDefault({ column, introspection, schemaLabel });
  const identity = column.identity;
  return {
    ...base,
    ...(fallback === undefined ? {} : { default: fallback }),
    ...(identity === undefined ? {} : { identity: identity === "always" ? "ALWAYS" : "BY DEFAULT" }),
  };
}

/** Project the trusted host schema into the DDL contract; plugin SQL never enters here.
 * @complexity O(index terms + columns + unique constraints); no I/O or source mutation.
 */
function coreIndexes({ cfg, introspection }: { cfg: CatalogTableConfig; introspection: CatalogIntrospection }, _optional = {}): TransferIndex[] {
  const declared = cfg.indexes.map((index) => {
    const label = index.name ?? cfg.name;
    const named = (term: { name: string | undefined }) => {
      if (term.name === undefined) throw new Error(`Index ${label} has a column with no name`);
      return term.name;
    };
    return {
      name: index.name ?? `${cfg.name}_idx`,
      columns: index.terms.flatMap((term) => term.kind === "sql" ? [] : [named(term)]),
      // The ORM's index rendering omits table qualifiers. Only the developer-owned schema supplies
      // expressions; introspected plugin expressions remain excluded by the snapshot planner.
      ...(index.terms.some((term) => term.kind === "sql") ? { expressions: index.terms.map((term) =>
        term.kind === "sql" ? `(${introspection.renderSql({ value: term.sql, indexTerm: true })})` : quoteIdent({ name: named(term) })) } : {}),
      unique: index.unique,
      // Only the developer-owned Postgres schema supplies SQL; plugin predicates stay excluded.
      ...(index.where === undefined ? {} : { where: introspection.renderSql({ value: index.where }) }),
    };
  });
  const uniqueColumns = cfg.columns.filter((column) => column.isUnique).map((column) => ({ name: column.uniqueName ?? `${cfg.name}_${column.name}_unique`, columns: [column.name], unique: true }));
  const uniqueConstraints = cfg.uniqueConstraints.map((constraint) => ({ name: constraint.name ?? `${cfg.name}_unique`, columns: [...constraint.columns], unique: true }));
  return [...declared, ...uniqueColumns, ...uniqueConstraints];
}

function coreTable({ table, catalog }: { table: unknown; catalog: CatalogSchemaPorts }, _optional = {}): TransferTable {
  const { introspection, schemaLabel } = catalog;
  const cfg = introspection.tableConfig(table);
  const inline = cfg.columns.filter((column) => column.primary).map((column) => column.name);
  const composite = cfg.primaryKeys.flatMap((pk) => pk.columns);
  const keep = catalog.partiallyExcluded[cfg.name]?.keep;
  return {
    name: cfg.name,
    columns: cfg.columns.map((column) => coreColumn({ column, introspection, schemaLabel })),
    primaryKey: inline.length > 0 ? inline : [...composite],
    ...(keep === undefined ? {} : { keep }),
    indexes: coreIndexes({ cfg, introspection }),
    foreignKeys: cfg.foreignKeys().map((fk) => ({
      name: fk.name,
      columns: [...fk.columns],
      foreignTable: fk.foreignTable,
      foreignColumns: [...fk.foreignColumns],
      onDelete: fk.onDelete ?? "no action",
      onUpdate: fk.onUpdate ?? "no action",
    })),
    checks: cfg.checks.map((check) => ({ name: check.name, sql: introspection.renderSql({ value: check.value }) })),
  };
}

function exportedTable({ catalog, exportName }: { catalog: CatalogSchemaPorts; exportName: string }, _optional = {}): unknown {
  const table = catalog.schema[exportName];
  if (table === undefined) throw new Error(`${catalog.schemaLabel} has no table exported as '${exportName}'; regenerate it`);
  return table;
}

/**
 * The core tables a copy carries, in foreign-key-safe order, logins and saved keys removed.
 *
 * @complexity O(tables + foreign keys).
 */
export function collectCatalogTransferTables({ catalog }: { catalog: CatalogSchemaPorts }, _optional: Record<string, never> = {}): TransferTable[] {
  return catalog.copyOrder().flatMap((exportName) => {
    const table = exportedTable({ catalog, exportName });
    if (catalog.introspection.tableName(table) in catalog.excludedTables) return [];
    return [coreTable({ table, catalog })];
  });
}

/**
 * EVERY table the host schema declares, in the same foreign-key-safe order, nothing left out:
 * the full schema a fresh Postgres database is created with.
 *
 * @complexity O(tables + foreign keys).
 */
export function collectCatalogSchemaTables({ catalog }: { catalog: CatalogSchemaPorts }, _optional: Record<string, never> = {}): TransferTable[] {
  return catalog.copyOrder().map((exportName) => coreTable({ table: exportedTable({ catalog, exportName }), catalog }));
}

/** Every SQL table name the host schema declares, copied or not. */
function coreTableNames({ catalog }: { catalog: CatalogSchemaPorts }, _optional = {}): Set<string> {
  const names = new Set<string>();
  for (const value of Object.values(catalog.schema)) {
    if (value !== null && typeof value === "object" && catalog.introspection.isTable(value)) names.add(catalog.introspection.tableName(value));
  }
  return names;
}

/** Host naming and policy for planning the snapshot of the content database (its schema is the catalog). */
export interface CatalogSnapshotPolicy {
  /** Migration ledgers stay behind: the target's runner owns its applied history. */
  readonly migrationLedgers: ReadonlySet<string>;
  /** Tables another database owns and copies; declared here too, they are reported left out with `chatReason`. */
  readonly foreignOwnedTables: readonly string[];
  /**
   * Why `foreignOwnedTables` are not copied from this database. A table declared from both files makes
   * `runCopy` refuse the whole copy, so exactly one database is the copy source for each.
   */
  readonly foreignOwnedReason: string;
  readonly bookkeepingPrefixes: readonly string[];
  readonly secretColumnPattern: RegExp;
}

export function planCatalogSnapshotTables({ source, catalog, policy }: { source: TransferSource; catalog: CatalogSchemaPorts; policy: CatalogSnapshotPolicy }, _optional = {}): SnapshotTablePlan {
  return planSnapshotTables({ source, policy: {
    coreTables: collectCatalogTransferTables({ catalog }), coreNames: coreTableNames({ catalog }),
    excludedTables: {
      ...catalog.excludedTables,
      ...Object.fromEntries(policy.foreignOwnedTables.map(name => [name, policy.foreignOwnedReason])),
    },
    derivedNames: catalog.derivedNames, migrationLedgers: policy.migrationLedgers,
    bookkeepingPrefixes: policy.bookkeepingPrefixes, secretColumnPattern: policy.secretColumnPattern,
  } });
}

/**
 * A database whose raw-SQL schema is introspected separately, never through a host ORM catalog.
 * `ownedTables` are copied first, in that order, then everything else by name.
 */
export function planIntrospectedSnapshotTables({ source, ownedTables, migrationLedgers, bookkeepingPrefixes }: { source: TransferSource; ownedTables: readonly string[]; migrationLedgers: ReadonlySet<string>; bookkeepingPrefixes: readonly string[] }, _optional = {}): SnapshotTablePlan {
  const plan = planSnapshotTables({ source, policy: {
    coreTables: [], coreNames: new Set(), excludedTables: {}, derivedNames: new Set(),
    migrationLedgers, bookkeepingPrefixes,
    // Owned transcript/session columns are data, not credential records; copy every owned table raw.
    secretColumnPattern: /(?!)/,
  } });
  return { ...plan, tables: [...plan.tables].sort((a, b) => {
    const rank = ({ name }: { name: string }, _options = {}) => ownedTables.includes(name) ? ownedTables.indexOf(name) : ownedTables.length;
    return rank({ name: a.name }) - rank({ name: b.name }) || a.name.localeCompare(b.name);
  }) };
}
