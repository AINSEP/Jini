import { type Kysely, sql } from "kysely";
import type { MigrationStep } from "./step.js";
import type { Ledger, LedgerRow } from "./runner.js";
import type { StorageDialect } from "../kernel/port.js";

/** Persisted identities remain host-owned; no existing row is rewritten. */
export interface LegacyLedgerMapping {
  columns: { version: string; name: string; checksum: string; appliedAt: string };
  identities: Readonly<Record<string, { version: number; name: string }>>;
  timestamps?: "database-default" | "iso";
}

/** Validate the whole map before backups, DDL or migration work. O(steps + identities). */
export function validateLegacyMapping({ mapping, steps }: { mapping: LegacyLedgerMapping; steps: readonly MigrationStep[] }, _optional: {} = {}): void {
  const columns = Object.values(mapping.columns);
  if (columns.some((column) => typeof column !== "string" || column.length === 0) || new Set(columns).size !== 4) {
    throw new Error("legacy ledger columns must be four distinct nonempty identifiers");
  }
  let previous = 0;
  const names = new Set<string>();
  for (const step of steps) {
    const identity = mapping.identities[step.id];
    if (!Object.hasOwn(mapping.identities, step.id) || identity === undefined) throw new Error(`missing legacy identity for ${step.id}`);
    validateIdentity({ identity });
    // Rows are read back in version order, so versions must ascend with the steps for an ordered-prefix check.
    if (identity.version <= previous || names.has(identity.name)) throw new Error("legacy identities must be unique with versions ascending in step order");
    previous = identity.version;
    names.add(identity.name);
  }
  if (Object.keys(mapping.identities).length !== steps.length) throw new Error("legacy identities must match the supplied steps");
}

function validateIdentity({ identity }: { identity: { version: number; name: string } }, _optional: {} = {}): void {
  if (!Number.isSafeInteger(identity.version) || identity.version <= 0) throw new Error("legacy versions must be positive safe integers");
  if (typeof identity.name !== "string" || identity.name.length === 0) throw new Error("legacy names must be nonempty strings");
}

export async function ensureLegacyLedger({ ledger, mapping, dialect }: { ledger: Ledger; mapping: LegacyLedgerMapping; dialect: StorageDialect }, _optional: {} = {}): Promise<void> {
  const c = mapping.columns;
  // Postgres integer is only 32-bit; mapped versions accept the full safe JS integer range.
  const versionType = dialect === "sqlite" ? "integer" : "bigint";
  await ledger.run((db) => db.schema.createTable(ledger.table).ifNotExists()
    .addColumn(c.version, versionType, (column) => column.primaryKey())
    .addColumn(c.name, "text", (column) => column.notNull())
    .addColumn(c.checksum, "text", (column) => column.notNull())
    .addColumn(c.appliedAt, "text", (column) => column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute());
}

/** Read in numeric version order, matching both parts of each persisted identity. */
export async function readLegacyLedger({ ledger, mapping }: { ledger: Ledger; mapping: LegacyLedgerMapping }, _optional: {} = {}): Promise<LedgerRow[]> {
  const c = mapping.columns;
  const byVersion = new Map(Object.entries(mapping.identities).map(([id, identity]) => [identity.version, { id, ...identity }]));
  const rows = await ledger.run((db) => db.selectFrom(ledger.table).select([
    sql<number>`${sql.id(c.version)}`.as("version"),
    sql<string>`${sql.id(c.name)}`.as("name"),
    sql<string>`${sql.id(c.checksum)}`.as("checksum"),
    sql<string>`${sql.id(c.appliedAt)}`.as("applied_at"),
  ]).orderBy(sql.id(c.version)).execute());
  return rows.map((row) => {
    const identity = byVersion.get(row.version);
    if (identity !== undefined && identity.name !== row.name) throw new Error(`legacy migration name drift at version ${row.version}`);
    return { id: identity?.id ?? `legacy:${row.version}:${row.name}`, checksum: row.checksum, applied_at: row.applied_at };
  });
}

export async function insertLegacyRow({ ledger, mapping, step, timestamp }: { ledger: Ledger; mapping: LegacyLedgerMapping; step: MigrationStep; timestamp: () => string }, _optional: {} = {}): Promise<void> {
  const c = mapping.columns;
  const identity = mapping.identities[step.id]!;
  const row: Record<string, unknown> = { [c.version]: identity.version, [c.name]: identity.name, [c.checksum]: step.checksum };
  if (mapping.timestamps === "iso") row[c.appliedAt] = timestamp();
  // The builder (not raw SQL) so the ledger's `withSchema` also places this insert.
  await ledger.run((db) => (db as unknown as Kysely<Record<string, Record<string, unknown>>>).insertInto(ledger.table).values(row).execute());
}
