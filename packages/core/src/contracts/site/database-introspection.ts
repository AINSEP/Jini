/** A schema's version index plus its migration-lineage tag (ADR-015 §5/RT-005). */
export interface SchemaSnapshot {
  version: number;
  tag: string;
}

export type DriftStatus = "in-sync" | "ahead" | "diverged" | "behind";

/**
 * @file `DatabaseIntrospectionPort` and its summary types — the port
 * `database_get_health`/`database_get_schema_state`/`database_list_pending_migrations`
 * (`tool-registrations.ts`) compose against, and `repo.memory.ts`'s
 * `InMemoryDatabaseIntrospectionAdapter` also implements.
 *
 * This path holds only ports and types so tool consumers do not depend on the concrete SQLite
 * adapter (`db/sqlite/database-introspection-adapter.sqlite.ts`) or the shared database module.
 */

export interface DatabaseHealthSummary {
  /** Whether the underlying `content.db` connection can still run a query at all. */
  canOpenDb: boolean;
  /** Whether `__drizzle_migrations` exists and a `SELECT` against it succeeds. */
  migrationsTableReadable: boolean;
  /** `"unknown"` when the applied migration identity is unavailable. Compare it to the persisted
   * stamp, or the real bundled runtime identity when no stamp is readable; never fabricate one. */
  driftStatus: DriftStatus | "unknown";
}

export interface SchemaStateSummary {
  status: DriftStatus | "unknown";
  siteMeta: SchemaSnapshot | null;
  runtime: SchemaSnapshot | null;
}

export interface PendingMigration {
  index: number;
  tag: string;
}

/** The port `database_get_health`/`database_get_schema_state`/`database_list_pending_migrations`
 * (`tool-registrations.ts`) compose against — mirrors `restore-points.ts`'s
 * `RestorePointListPort`/`RestorePointSavePort` and `@jini-ai/db/tools`' `LedgerReadPort`: a small,
 * domain-declared interface a real adapter and an in-memory double both satisfy.
 */
export interface DatabaseIntrospectionPort {
  getHealth(): Promise<DatabaseHealthSummary>;
  getSchemaState(): Promise<SchemaStateSummary>;
  listPendingMigrations(): Promise<{ items: PendingMigration[] }>;
}
